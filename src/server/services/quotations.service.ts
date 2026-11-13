// Quotations per project: BOQ items, status workflow, revisions and an event log.

import ExcelJS from "exceljs";
import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError } from "./planning.service";
import { dateToIso, isoToDate } from "@/features/planning/calendar";
import {
  addDays, canTransition, isEditable, lineTotal, monthlyTrend, quotationNumber, summarize, totals, STATUS_LABEL,
  type QStatus,
} from "@/features/quotations/quotation";
import { parseQuotationSheet } from "@/features/quotations/sheet";
import type { QuotationDetailDTO, QuotationEventDTO, QuotationRowDTO, QuotationsData } from "@/features/quotations/dto";
import type { QuotationInput, QuotationPatch } from "@/server/validators/quotations";

export class QuotationError extends PlanningError {}

const i2 = (d: Date | null | undefined) => (d ? dateToIso(d) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

type Row = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(projectId: string) {
  return prisma.quotation.findMany({
    where: { projectId },
    include: { items: { select: { qty: true, unitRate: true, type: true } } },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }, { revision: "desc" }],
  });
}

function toRow(q: Row, revisionCount: number): QuotationRowDTO {
  const t = totals(q.items);
  return {
    id: q.id, number: q.number, revision: q.revision, section: q.section, description: q.description,
    status: q.status, currency: q.currency, total: t.grand, supply: t.supply, install: t.install,
    issueDate: dateToIso(q.issueDate), validUntil: i2(q.validUntil), itemCount: q.items.length, revisionCount,
  };
}

const eventDTO = (e: { id: string; kind: string; message: string; createdAt: Date; user: { name: string } | null }, quotationNumber?: string): QuotationEventDTO =>
  ({ id: e.id, kind: e.kind, message: e.message, at: e.createdAt.toISOString(), by: e.user?.name ?? null, quotationNumber });

/** Latest revision of every quotation number in the project, plus summary, trend and recent activity. */
export async function getQuotationsData(projectId: string): Promise<QuotationsData> {
  const all = await loadRows(projectId);
  const counts = new Map<string, number>();
  for (const q of all) counts.set(q.number, (counts.get(q.number) ?? 0) + 1);
  const latest = new Map<string, Row>();
  for (const q of all) { const cur = latest.get(q.number); if (!cur || q.revision > cur.revision) latest.set(q.number, q); }
  const rows = [...latest.values()].map((q) => toRow(q, counts.get(q.number)!)).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));

  const ev = await prisma.quotationEvent.findMany({
    where: { quotation: { projectId } }, orderBy: { createdAt: "desc" }, take: 6,
    include: { user: { select: { name: true } }, quotation: { select: { number: true, revision: true } } },
  });
  const today = todayIso();
  return {
    today, rows, summary: summarize(rows), trend: monthlyTrend(rows, today, 6),
    events: ev.map((e) => eventDTO(e, `${e.quotation.number}${e.quotation.revision ? ` Rev. ${e.quotation.revision}` : ""}`)),
  };
}

export async function getQuotationDetail(projectId: string, id: string): Promise<QuotationDetailDTO | null> {
  const q = await prisma.quotation.findFirst({
    where: { id, projectId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      events: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      project: { select: { id: true, number: true, name: true, customer: { select: { name: true } } } },
    },
  });
  if (!q) return null;
  const siblings = await prisma.quotation.findMany({
    where: { projectId, number: q.number }, orderBy: { revision: "asc" },
    include: { items: { select: { qty: true, unitRate: true, type: true } } },
  });
  const t = totals(q.items);
  const base = toRow({ ...q, items: q.items }, siblings.length);
  return {
    ...base,
    profitMargin: q.profitMargin, preparedBy: q.preparedBy, approvedBy: q.approvedBy, decidedAt: i2(q.decidedAt),
    terms: q.terms, notes: q.notes, grand: t.grand, editable: isEditable(q.status),
    items: q.items.map((i) => ({ id: i.id, description: i.description, material: i.material, qty: i.qty, unit: i.unit, unitRate: i.unitRate, type: i.type, total: lineTotal(i) })),
    events: q.events.map((e) => eventDTO(e)),
    revisions: siblings.map((s) => ({ id: s.id, revision: s.revision, status: s.status, total: totals(s.items).grand, issueDate: dateToIso(s.issueDate) })),
    project: { id: q.project.id, number: q.project.number, name: q.project.name, customer: q.project.customer.name },
  };
}

async function nextNumber(projectId: string, year: number) {
  const numbers = new Set((await prisma.quotation.findMany({ where: { projectId }, select: { number: true } })).map((q) => q.number));
  let seq = numbers.size + 1;
  while (numbers.has(quotationNumber(seq, year))) seq++;
  return quotationNumber(seq, year);
}

async function note(quotationId: string, userId: string, kind: string, message: string) {
  await prisma.quotationEvent.create({ data: { quotationId, userId, kind, message } });
}

const itemRows = (items: NonNullable<QuotationInput["items"]>) =>
  items.map((i, n) => ({ sortOrder: n, description: i.description, material: i.material || null, qty: i.qty, unit: i.unit || "kg", unitRate: i.unitRate, type: i.type }));

export async function createQuotation(projectId: string, input: QuotationInput, user: { id: string; name: string }) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new QuotationError("Project not found", 404);
  const issue = input.issueDate ?? todayIso();
  const number = await nextNumber(projectId, Number(issue.slice(0, 4)));
  const q = await prisma.quotation.create({
    data: {
      projectId, number, section: input.section || null, description: input.description, currency: input.currency || "EGP",
      issueDate: isoToDate(issue), validUntil: isoToDate(input.validUntil ?? addDays(issue, 30)),
      profitMargin: input.profitMargin ?? null, preparedBy: input.preparedBy || user.name,
      terms: input.terms || null, notes: input.notes || null, createdById: user.id,
      items: input.items?.length ? { create: itemRows(input.items) } : undefined,
    },
  });
  await note(q.id, user.id, "CREATED", "New quotation created");
  await logActivity({ userId: user.id, action: "CREATE", entity: "QUOTATION", entityId: q.id, detail: `${q.number} — ${q.description}` });
  return q;
}

export async function updateQuotation(projectId: string, id: string, input: QuotationPatch, user: { id: string; name: string }) {
  const q = await prisma.quotation.findFirst({ where: { id, projectId } });
  if (!q) throw new QuotationError("Quotation not found", 404);
  if (!isEditable(q.status)) throw new QuotationError(`A ${STATUS_LABEL[q.status as QStatus].toLowerCase()} quotation is locked — create a revision to change it.`, 409);
  const issue = input.issueDate ?? dateToIso(q.issueDate);
  const validUntil = input.validUntil === undefined ? q.validUntil : input.validUntil ? isoToDate(input.validUntil) : null;
  if (validUntil && validUntil < isoToDate(issue)) throw new QuotationError("“Valid until” cannot be before the issue date.");

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id },
      data: {
        section: input.section === undefined ? undefined : input.section || null,
        description: input.description, currency: input.currency,
        issueDate: input.issueDate ? isoToDate(input.issueDate) : undefined, validUntil,
        profitMargin: input.profitMargin === undefined ? undefined : input.profitMargin,
        preparedBy: input.preparedBy === undefined ? undefined : input.preparedBy || null,
        terms: input.terms === undefined ? undefined : input.terms || null,
        notes: input.notes === undefined ? undefined : input.notes || null,
      },
    });
    if (input.items) {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      if (input.items.length) await tx.quotationItem.createMany({ data: input.items.map((i, n) => ({ ...itemRows([i])[0], sortOrder: n, quotationId: id })) });
    }
  });
  await note(id, user.id, "UPDATED", input.items ? `BOQ updated (${input.items.length} items)` : "Quotation updated");
  await logActivity({ userId: user.id, action: "UPDATE", entity: "QUOTATION", entityId: id, detail: q.number });
}

export async function setQuotationStatus(projectId: string, id: string, to: QStatus, user: { id: string; name: string }, noteText?: string) {
  const q = await prisma.quotation.findFirst({ where: { id, projectId }, include: { _count: { select: { items: true } } } });
  if (!q) throw new QuotationError("Quotation not found", 404);
  if (!canTransition(q.status as QStatus, to)) throw new QuotationError(`A quotation cannot go from ${STATUS_LABEL[q.status as QStatus]} to ${STATUS_LABEL[to]}.`, 409);
  if ((to === "PENDING" || to === "UNDER_REVIEW") && q._count.items === 0) throw new QuotationError("Add at least one BOQ item before submitting.", 409);
  const decided = to === "APPROVED" || to === "REJECTED";
  await prisma.quotation.update({ where: { id }, data: { status: to, approvedBy: decided ? user.name : null, decidedAt: decided ? new Date() : null } });
  const verb = { DRAFT: "returned to draft", PENDING: "submitted", UNDER_REVIEW: "sent for review", APPROVED: "approved", REJECTED: "rejected" }[to];
  await note(id, user.id, to === "APPROVED" ? "APPROVED" : to === "REJECTED" ? "REJECTED" : "SUBMITTED", `Quotation ${verb} by ${user.name}${noteText ? ` — ${noteText}` : ""}`);
  await logActivity({ userId: user.id, action: "UPDATE", entity: "QUOTATION", entityId: id, detail: `${q.number} → ${STATUS_LABEL[to]}` });
}

/** Copy to the next revision (same number), as a draft. */
export async function reviseQuotation(projectId: string, id: string, user: { id: string; name: string }) {
  const q = await prisma.quotation.findFirst({ where: { id, projectId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!q) throw new QuotationError("Quotation not found", 404);
  const newer = await prisma.quotation.findFirst({ where: { projectId, number: q.number, revision: { gt: q.revision } }, select: { revision: true } });
  if (newer) throw new QuotationError(`Revision ${newer.revision} already exists — revise that one instead.`, 409);
  const today = todayIso();
  const copy = await prisma.quotation.create({
    data: {
      projectId, number: q.number, revision: q.revision + 1, section: q.section, description: q.description, currency: q.currency,
      issueDate: isoToDate(today), validUntil: isoToDate(addDays(today, 30)), profitMargin: q.profitMargin,
      preparedBy: user.name, terms: q.terms, notes: q.notes, createdById: user.id,
      items: { create: q.items.map((i, n) => ({ sortOrder: n, description: i.description, material: i.material, qty: i.qty, unit: i.unit, unitRate: i.unitRate, type: i.type })) },
    },
  });
  await note(copy.id, user.id, "REVISED", `Revision ${copy.revision} created from Rev. ${q.revision}`);
  await logActivity({ userId: user.id, action: "CREATE", entity: "QUOTATION", entityId: copy.id, detail: `${q.number} Rev. ${copy.revision}` });
  return copy;
}

export async function deleteQuotation(projectId: string, id: string, userId: string) {
  const q = await prisma.quotation.findFirst({ where: { id, projectId } });
  if (!q) throw new QuotationError("Quotation not found", 404);
  await prisma.quotation.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "QUOTATION", entityId: id, detail: `${q.number} Rev. ${q.revision}` });
}

/** Create a draft quotation from a BOQ spreadsheet. */
export async function importQuotationFromExcel(projectId: string, buffer: ArrayBuffer, fileName: string, user: { id: string; name: string }) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new QuotationError("That file could not be read as .xlsx."); }
  const ws = wb.worksheets[0];
  if (!ws) throw new QuotationError("The workbook has no sheets.");
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (c, n) => { const v = c.value; cells[n - 1] = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v && typeof v === "object" && "text" in v ? (v as { text: string }).text : v; });
    rows.push(cells);
  });
  const parsed = parseQuotationSheet(rows);
  if (parsed.items.length === 0) throw new QuotationError(parsed.warnings[0] ?? "No BOQ rows found.");
  const q = await createQuotation(projectId, { description: fileName.replace(/\.[^.]+$/, "") || "Imported BOQ", items: parsed.items }, user);
  return { id: q.id, number: q.number, created: parsed.items.length, warnings: parsed.warnings };
}
