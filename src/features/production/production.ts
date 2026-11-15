// Pure rules for production tracking (no Prisma / React) so they can be unit-tested.
//
// A work order = one takeoff part × qty pieces. Every piece goes through four stages in order; the time each stage
// was finished is what we keep. Progress is counted by WEIGHT: a heavy beam moves the project more than a small plate.

export const STAGES = ["CUTTING", "ASSEMBLY", "WELDING", "PAINTING"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = { CUTTING: "Cutting", ASSEMBLY: "Assembly", WELDING: "Welding", PAINTING: "Painting" };
/** Column of the piece row that holds the finish time of each stage. */
export const STAGE_FIELD = { CUTTING: "cutAt", ASSEMBLY: "assembledAt", WELDING: "weldedAt", PAINTING: "paintedAt" } as const;
export type StageField = (typeof STAGE_FIELD)[Stage];

/** Share of a piece's completion that each stage represents (sums to 100). */
export const STAGE_WEIGHT: Record<Stage, number> = { CUTTING: 25, ASSEMBLY: 25, WELDING: 35, PAINTING: 15 };

export interface PieceState { id?: string; seq: number; cutAt: Date | string | null; assembledAt: Date | string | null; weldedAt: Date | string | null; paintedAt: Date | string | null }

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const stageDone = (p: PieceState, s: Stage) => p[STAGE_FIELD[s]] != null;
export const prevStage = (s: Stage): Stage | null => STAGES[STAGES.indexOf(s) - 1] ?? null;

/** A stage can only be finished after the one before it, and only once. */
export const canComplete = (p: PieceState, s: Stage) => !stageDone(p, s) && (prevStage(s) === null || stageDone(p, prevStage(s)!));
/** Only the latest finished stage can be undone (so the order is never broken). */
export function canUndo(p: PieceState, s: Stage) {
  const next = STAGES[STAGES.indexOf(s) + 1];
  return stageDone(p, s) && (!next || !stageDone(p, next));
}
/** The stage a piece is waiting for, or null when it is finished. */
export const nextStage = (p: PieceState): Stage | null => STAGES.find((s) => !stageDone(p, s)) ?? null;
/** The latest stage a piece has finished, or null. */
export const lastDoneStage = (p: PieceState): Stage | null => [...STAGES].reverse().find((s) => stageDone(p, s)) ?? null;

/** 0–100: the stage weights of the stages the piece has finished. */
export const pieceProgress = (p: PieceState) => STAGES.reduce((sum, s) => sum + (stageDone(p, s) ? STAGE_WEIGHT[s] : 0), 0);

// ---------------------------------------------------------------------------------------------- work order

export interface WorkOrderStats {
  pieces: number;
  /** pieces that finished each stage */
  done: Record<Stage, number>;
  /** 0–100 by weight of the order's own pieces (all pieces weigh the same inside an order) */
  progress: number;
  totalKg: number;
  /** weight made so far = total × progress */
  producedKg: number;
}

export function workOrderStats(pieces: PieceState[], unitWeightKg: number): WorkOrderStats {
  const done = Object.fromEntries(STAGES.map((s) => [s, pieces.filter((p) => stageDone(p, s)).length])) as Record<Stage, number>;
  const sum = pieces.reduce((t, p) => t + pieceProgress(p), 0);
  const progress = pieces.length ? sum / pieces.length : 0;
  const totalKg = pieces.length * unitWeightKg;
  return { pieces: pieces.length, done, progress: r1(progress), totalKg: r2(totalKg), producedKg: r2((totalKg * progress) / 100) };
}

/** The first `n` pieces (by number) that are ready for `stage`: the stage before is done, this one is not. */
export function pickEligible(pieces: PieceState[], stage: Stage, n: number): PieceState[] {
  return pieces.filter((p) => canComplete(p, stage)).sort((a, b) => a.seq - b.seq).slice(0, Math.max(0, n));
}

// ---------------------------------------------------------------------------------------------- project

export interface ProjectProduction {
  /** total weight of the project (all takeoff parts), kg */
  totalKg: number;
  /** weight made so far, kg (stage-weighted) */
  producedKg: number;
  /** 0–100 */
  percent: number;
  /** weight whose pieces have finished each stage, kg */
  byStageKg: Record<Stage, number>;
  /** weight that has no work order yet, kg */
  unplannedKg: number;
}

/**
 * Tons made ÷ total tons. The denominator is the whole project's weight, not only what has a work order,
 * so a part nobody released to the shop counts as not started instead of disappearing from the percentage.
 */
export function projectProduction(orders: { unitWeightKg: number; pieces: PieceState[] }[], totalKg: number): ProjectProduction {
  let produced = 0;
  let planned = 0;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const o of orders) {
    for (const p of o.pieces) {
      planned += o.unitWeightKg;
      produced += (o.unitWeightKg * pieceProgress(p)) / 100;
      for (const s of STAGES) if (stageDone(p, s)) byStage[s] += o.unitWeightKg;
    }
  }
  const denom = Math.max(totalKg, planned); // a work order can never make the percentage exceed 100
  return {
    totalKg: r2(denom),
    producedKg: r2(produced),
    percent: denom > 0 ? r1(Math.min(100, (produced / denom) * 100)) : 0,
    byStageKg: Object.fromEntries(STAGES.map((s) => [s, r2(byStage[s])])) as Record<Stage, number>,
    unplannedKg: r2(Math.max(0, denom - planned)),
  };
}

// ---------------------------------------------------------------------------------------------- QR code text

export const pieceCode = (workOrderNumber: string, seq: number) => `${workOrderNumber}-${String(seq).padStart(3, "0")}`;

/** "WO-2026-0001-007" → { number: "WO-2026-0001", seq: 7 } */
export function parsePieceCode(code: string): { number: string; seq: number } | null {
  const m = /^(WO-\d{4}-\d{4,})-(\d{1,6})$/.exec(code.trim().toUpperCase());
  return m ? { number: m[1], seq: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------------------------- schedule link

/** The WBS node and everything below it. */
export function descendantWbsIds(wbs: { id: string; parentId: string | null }[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of wbs) if (w.parentId && out.has(w.parentId) && !out.has(w.id)) { out.add(w.id); grew = true; }
  }
  return out;
}

/** Unit weight of one piece from a takeoff part (its weight is for the whole quantity). */
export const unitWeight = (partWeightKg: number, qty: number) => (qty > 0 ? partWeightKg / qty : 0);
