// Convert a tendering project to execution: freeze the budget from the approved quotations, build the first
// schedule from their BOQ, send the nest's material needs to Materials, and save the baseline.
//
// The project's stage is switched LAST, so a step that fails leaves it in tendering and the conversion can simply be
// run again: every step skips or updates what a previous attempt already did.

import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError, createSchedule, recalculate, setBaseline } from "./planning.service";
import { syncNestMaterials } from "./materials.service";
import { dateToIso, isoToDate } from "@/features/planning/calendar";
import { totals } from "@/features/quotations/quotation";
import { decodeSnapshot } from "@/features/nesting/nest-boost/persist";
import { isExact } from "@/features/nesting/nest-boost/engine";
import { buildMaterialRequests, toMaterialPayload, type MaterialRequestLine } from "@/features/nesting/nest-boost/material-requests";
import {
  evaluatePreflight, freezeBudget, planBoqSchedule,
  type ApprovedQuotation, type BoqItem, type FrozenBudget, type NestSummary, type Preflight,
} from "@/features/execution/execution";
import type { ConvertExecutionInput } from "@/server/validators/project";

export class ExecutionError extends PlanningError {}

const todayIso = () => new Date().toISOString().slice(0, 10);

export interface ExecutionPreflight extends Preflight {
  project: { id: string; number: string; name: string; stage: "TENDERING" | "EXECUTION"; status: string; startDate: string | null };
  approved: ApprovedQuotation[];
  budget: FrozenBudget | null;
  boqItems: number;
  schedule: { exists: boolean; activities: number };
  nest: NestSummary;
  /** set once the project is in execution */
  converted: { at: string; budget: FrozenBudget | null } | null;
}

/** Latest revision of each quotation number that is approved, with its items. */
async function approvedQuotations(projectId: string) {
  const all = await prisma.quotation.findMany({
    where: { projectId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ number: "asc" }, { revision: "desc" }],
  });
  const latest = new Map<string, (typeof all)[number]>();
  for (const q of all) if (!latest.has(q.number)) latest.set(q.number, q); // revision desc: the first one is the latest
  return [...latest.values()].filter((q) => q.status === "APPROVED");
}

async function loadNest(projectId: string): Promise<{ summary: NestSummary; lines: MaterialRequestLine[] }> {
  const empty = { summary: { hasResult: false, lines: 0, exact: 0, approx: 0, approxNames: [] as string[] }, lines: [] as MaterialRequestLine[] };
  const ws = await prisma.nestingWorkspace.findUnique({ where: { projectId_kind: { projectId, kind: "2D" } }, select: { dataJson: true } });
  const snap = ws ? decodeSnapshot(ws.dataJson) : null;
  if (!snap) return empty;

  // only parts that are actually on a sheet count (a segmented original is never nested, its pieces are)
  const onSheet = new Map<number, (typeof snap.groups)[number]>();
  for (const sh of snap.result?.sheets ?? []) for (const it of sh.items) onSheet.set(it.g.id, it.g);
  const nested = [...onSheet.values()];
  const approx = nested.filter((g) => !isExact(g));
  const hasResult = !!snap.result && !!snap.resS && snap.result.sheets.length > 0;
  const lines = hasResult ? buildMaterialRequests(snap.result!, snap.resS!) : [];
  return {
    summary: { hasResult, lines: lines.length, exact: nested.length - approx.length, approx: approx.length, approxNames: approx.slice(0, 8).map((g) => g.name) },
    lines,
  };
}

const boqOf = (qs: Awaited<ReturnType<typeof approvedQuotations>>): BoqItem[] =>
  qs.flatMap((q) => q.items.map((i) => ({ description: i.description, material: i.material, type: i.type, qty: i.qty, unit: i.unit })));

const toApproved = (q: Awaited<ReturnType<typeof approvedQuotations>>[number]): ApprovedQuotation => {
  const t = totals(q.items);
  return { number: q.number, revision: q.revision, currency: q.currency, total: t.grand, supply: t.supply, install: t.install };
};

export async function getExecutionPreflight(projectId: string): Promise<ExecutionPreflight | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, number: true, name: true, stage: true, status: true, startDate: true, executionBudget: true, executionStartedAt: true },
  });
  if (!project) return null;

  const [qs, schedule, nest] = await Promise.all([
    approvedQuotations(projectId),
    prisma.planSchedule.findUnique({ where: { projectId }, select: { id: true, _count: { select: { activities: true } } } }),
    loadNest(projectId),
  ]);
  const approved = qs.map(toApproved);
  const budget = freezeBudget(approved, todayIso());
  const boqItems = qs.reduce((n, q) => n + q.items.length, 0);
  const activities = schedule?._count.activities ?? null;
  const checks = evaluatePreflight({ stage: project.stage, approved, boqItems, scheduleActivities: activities, nest: nest.summary });

  return {
    ...checks,
    project: { id: project.id, number: project.number, name: project.name, stage: project.stage, status: project.status, startDate: project.startDate ? dateToIso(project.startDate) : null },
    approved,
    budget: "error" in budget ? null : budget,
    boqItems,
    schedule: { exists: !!schedule, activities: activities ?? 0 },
    nest: nest.summary,
    converted: project.executionStartedAt ? { at: project.executionStartedAt.toISOString(), budget: (project.executionBudget as FrozenBudget | null) ?? null } : null,
  };
}

export interface ConversionResult {
  budget: FrozenBudget;
  schedule: { created: boolean; activities: number; baselineSaved: boolean };
  materials: { created: number; updated: number; skipped: string | null };
}

export async function convertToExecution(projectId: string, opts: ConvertExecutionInput, userId: string): Promise<ConversionResult> {
  const pre = await getExecutionPreflight(projectId);
  if (!pre) throw new ExecutionError("Project not found", 404);
  if (pre.blockers.length) throw new ExecutionError(pre.blockers[0], 409);
  if (pre.warnings.some((w) => w.code === "APPROXIMATE_PARTS") && !opts.acceptApproximate) {
    throw new ExecutionError("Some parts are approximate. Confirm that you want to convert anyway.", 409);
  }

  const qs = await approvedQuotations(projectId);
  const budget = freezeBudget(qs.map(toApproved), todayIso());
  if ("error" in budget) throw new ExecutionError(budget.error, 409);

  const startDate = opts.startDate ?? pre.project.startDate ?? todayIso();

  // ---- 1. schedule from the BOQ (+ baseline)
  const schedule = { created: false, activities: pre.schedule.activities, baselineSaved: false };
  let supplyWbsId: string | null = null; // the WBS production will drive (set below when the schedule is built here)
  const plan = planBoqSchedule(boqOf(qs), { supplyDays: opts.supplyDays, installDays: opts.installDays });
  let existing = await prisma.planSchedule.findUnique({ where: { projectId }, select: { id: true, _count: { select: { activities: true } } } });
  if (!existing && plan.activities.length) {
    await createSchedule(projectId, { name: `${pre.project.number} — Execution schedule`, startDate, starterWbs: false }, userId);
    existing = await prisma.planSchedule.findUnique({ where: { projectId }, select: { id: true, _count: { select: { activities: true } } } });
    schedule.created = true;
  }
  if (existing && existing._count.activities === 0 && plan.activities.length) {
    const scheduleId = existing.id;
    const wbsId = new Map(plan.wbs.map((w) => [w.key, randomUUID()]));
    const actId = new Map(plan.activities.map((a) => [a.key, randomUUID()]));
    await prisma.$transaction([
      prisma.planWbs.createMany({ data: plan.wbs.map((w, i) => ({ id: wbsId.get(w.key)!, scheduleId, code: w.code, name: w.name, sortOrder: i + 1 })) }),
      prisma.planActivity.createMany({
        data: plan.activities.map((a, i) => ({
          id: actId.get(a.key)!, scheduleId, code: a.code, name: a.name, type: a.type, durationDays: a.durationDays,
          wbsId: a.wbsKey ? wbsId.get(a.wbsKey)! : null, sortOrder: i + 1,
        })),
      }),
      prisma.planRelationship.createMany({
        data: plan.activities.flatMap((a) => a.after.map((p) => ({ scheduleId, predecessorId: actId.get(p)!, successorId: actId.get(a.key)!, type: "FS" as const, lagDays: 0 }))),
      }),
    ]);
    await recalculate(scheduleId);
    supplyWbsId = wbsId.get("SUPPLY") ?? null;
    schedule.created = true;
    schedule.activities = plan.activities.length;
  }
  if (existing) {
    const hasBaseline = (await prisma.planBaseline.count({ where: { scheduleId: existing.id } })) > 0;
    const hasActivities = (await prisma.planActivity.count({ where: { scheduleId: existing.id } })) > 0;
    if (!hasBaseline && hasActivities) { await setBaseline(projectId, "Baseline — execution start", userId); schedule.baselineSaved = true; }
  }

  // ---- 2. material requests from the nest
  const nest = await loadNest(projectId);
  const materials = { created: 0, updated: 0, skipped: null as string | null };
  if (nest.lines.length) {
    const r = await syncNestMaterials(projectId, nest.lines.map((l) => toMaterialPayload(l, opts.materialUnit)), userId);
    materials.created = r.created; materials.updated = r.updated;
  } else materials.skipped = "No nesting result to take material from.";

  // ---- 3. last: the project itself (budget + stage), so a failure above leaves it in tendering and re-runnable
  await prisma.project.update({
    where: { id: projectId },
    data: {
      stage: "EXECUTION", status: "IN_PROGRESS",
      startDate: pre.project.startDate ? undefined : isoToDate(startDate),
      executionBudget: budget as object, executionStartedAt: new Date(),
      ...(supplyWbsId ? { productionWbsId: supplyWbsId } : {}),
    },
  });
  await logActivity({ userId, action: "UPDATE", entity: "PROJECT", entityId: projectId, detail: `${pre.project.number} converted to execution (budget ${budget.currency} ${budget.total})` });

  return { budget, schedule, materials };
}
