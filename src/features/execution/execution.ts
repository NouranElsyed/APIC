// Pure logic for "Convert to Execution" (no Prisma / React) so it can be unit-tested:
// what blocks the conversion, what only deserves a warning, the budget frozen from the approved quotations,
// and the first schedule built from their BOQ.

export type BoqType = "SUPPLY" | "INSTALL";

export interface BoqItem { description: string; material: string | null; type: BoqType; qty: number; unit: string }

export interface ApprovedQuotation { number: string; revision: number; currency: string; total: number; supply: number; install: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ----------------------------------------------------------------------------------------- budget

export interface FrozenBudget {
  currency: string;
  total: number;
  supply: number;
  install: number;
  quotations: { number: string; revision: number; total: number }[];
  frozenAt: string;
}

/** The budget of the project = the approved quotations at the moment it goes to execution. */
export function freezeBudget(approved: ApprovedQuotation[], frozenAt: string): FrozenBudget | { error: string } {
  if (!approved.length) return { error: "No approved quotation" };
  const currencies = new Set(approved.map((q) => q.currency));
  if (currencies.size > 1) return { error: `The approved quotations use different currencies (${[...currencies].join(", ")})` };
  const sum = (f: (q: ApprovedQuotation) => number) => r2(approved.reduce((s, q) => s + f(q), 0));
  return {
    currency: approved[0].currency,
    total: sum((q) => q.total), supply: sum((q) => q.supply), install: sum((q) => q.install),
    quotations: approved.map((q) => ({ number: q.number, revision: q.revision, total: q.total })),
    frozenAt,
  };
}

// ----------------------------------------------------------------------------------------- pre-flight

export interface NestSummary {
  /** a nest with at least one sheet exists for the project */
  hasResult: boolean;
  /** material lines it would send to Materials */
  lines: number;
  exact: number;
  approx: number;
  /** a few names of the approximate parts, to show the user which ones to fix */
  approxNames: string[];
}

export interface PreflightInput {
  stage: "TENDERING" | "EXECUTION";
  approved: ApprovedQuotation[];
  boqItems: number;
  scheduleActivities: number | null; // null = no schedule yet
  nest: NestSummary;
}

export type WarningCode = "APPROXIMATE_PARTS" | "NO_NEST" | "NO_BOQ" | "SCHEDULE_EXISTS";
export interface PreflightWarning { code: WarningCode; text: string }
export interface Preflight { blockers: string[]; warnings: PreflightWarning[] }

export function evaluatePreflight(i: PreflightInput): Preflight {
  const blockers: string[] = [];
  const warnings: PreflightWarning[] = [];

  if (i.stage === "EXECUTION") blockers.push("This project is already in execution.");
  if (!i.approved.length) blockers.push("Approve a quotation first — its value becomes the project budget.");
  else if (new Set(i.approved.map((q) => q.currency)).size > 1) blockers.push("The approved quotations use different currencies; keep one currency before converting.");

  if (i.nest.approx > 0) {
    warnings.push({
      code: "APPROXIMATE_PARTS",
      text: `${i.nest.approx} of ${i.nest.exact + i.nest.approx} nested part${i.nest.exact + i.nest.approx === 1 ? " is" : "s are"} approximate (drawn for pricing only). The material quantities will be an estimate until they are drawn exactly.`,
    });
  }
  if (!i.nest.hasResult) warnings.push({ code: "NO_NEST", text: "There is no nesting result yet, so no material requests will be created." });
  if (i.boqItems === 0 && i.approved.length) warnings.push({ code: "NO_BOQ", text: "The approved quotations have no BOQ items, so no schedule will be built." });
  if (i.scheduleActivities !== null && i.scheduleActivities > 0) {
    warnings.push({ code: "SCHEDULE_EXISTS", text: `The project already has a schedule (${i.scheduleActivities} activities). It is kept as it is; a baseline is only saved if none exists.` });
  }
  return { blockers, warnings };
}

// ----------------------------------------------------------------------------------------- schedule from the BOQ

export interface PlannedWbs { key: BoqType; code: string; name: string }
export interface PlannedActivity {
  key: string;
  code: string;
  name: string;
  type: "TASK" | "MILESTONE_START" | "MILESTONE_FINISH";
  durationDays: number;
  wbsKey: BoqType | null;
  /** finish-to-start predecessors, by key */
  after: string[];
}
export interface PlannedSchedule { wbs: PlannedWbs[]; activities: PlannedActivity[] }

export const MAX_BOQ_ACTIVITIES = 300;
const WBS_NAME: Record<BoqType, string> = { SUPPLY: "Supply & Fabrication", INSTALL: "Dismantle & Install" };

/**
 * First schedule from the BOQ: Project start → every supply item (in parallel) → "Supply complete"
 * → every install item (in parallel) → "Project complete". Durations are a starting guess (working days),
 * meant to be edited in Planning; the baseline is saved right after, so the first edit is already tracked.
 */
export function planBoqSchedule(items: BoqItem[], o: { supplyDays: number; installDays: number }): PlannedSchedule {
  if (!items.length) return { wbs: [], activities: [] };
  const supply = items.filter((i) => i.type !== "INSTALL");
  const install = items.filter((i) => i.type === "INSTALL");
  if (items.length > MAX_BOQ_ACTIVITIES) throw new Error(`The BOQ has ${items.length} items; the first schedule is limited to ${MAX_BOQ_ACTIVITIES}. Group the BOQ or build the schedule in Planning.`);

  const wbs: PlannedWbs[] = [];
  if (supply.length) wbs.push({ key: "SUPPLY", code: String(wbs.length + 1), name: WBS_NAME.SUPPLY });
  if (install.length) wbs.push({ key: "INSTALL", code: String(wbs.length + 1), name: WBS_NAME.INSTALL });

  const acts: PlannedActivity[] = [];
  const add = (a: Omit<PlannedActivity, "code">) => { acts.push({ ...a, code: `A${1000 + acts.length * 10}` }); return a.key; };
  const label = (i: BoqItem) => (i.material ? `${i.description} — ${i.material}` : i.description).slice(0, 200);
  const days = (n: number) => Math.max(1, Math.round(n));

  const start = add({ key: "start", name: "Project start", type: "MILESTONE_START", durationDays: 0, wbsKey: null, after: [] });
  const supplyKeys = supply.map((it, n) => add({ key: `s${n}`, name: label(it), type: "TASK", durationDays: days(o.supplyDays), wbsKey: "SUPPLY", after: [start] }));
  let gate = start;
  if (supply.length && install.length) gate = add({ key: "supplyDone", name: "Supply complete", type: "MILESTONE_FINISH", durationDays: 0, wbsKey: null, after: supplyKeys });
  const installKeys = install.map((it, n) => add({ key: `i${n}`, name: label(it), type: "TASK", durationDays: days(o.installDays), wbsKey: "INSTALL", after: [gate] }));
  add({ key: "finish", name: "Project complete", type: "MILESTONE_FINISH", durationDays: 0, wbsKey: null, after: install.length ? installKeys : supplyKeys });
  return { wbs, activities: acts };
}
