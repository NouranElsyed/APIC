import { describe, expect, it } from "vitest";
import {
  STAGE_WEIGHT, STAGES, canComplete, canUndo, descendantWbsIds, lastDoneStage, nextStage, parsePieceCode, pickEligible, pieceCode, pieceProgress,
  projectProduction, unitWeight, workOrderStats, type PieceState,
} from "./production";

const t = new Date("2026-11-01T10:00:00Z");
const piece = (seq: number, done: number): PieceState => ({ seq, cutAt: done > 0 ? t : null, assembledAt: done > 1 ? t : null, weldedAt: done > 2 ? t : null, paintedAt: done > 3 ? t : null });

describe("stage weights", () => it("sum to 100", () => expect(STAGES.reduce((s, x) => s + STAGE_WEIGHT[x], 0)).toBe(100)));

describe("piece rules", () => {
  it("progress is the weight of the finished stages", () => {
    expect(pieceProgress(piece(1, 0))).toBe(0);
    expect(pieceProgress(piece(1, 1))).toBe(25);
    expect(pieceProgress(piece(1, 3))).toBe(85);
    expect(pieceProgress(piece(1, 4))).toBe(100);
  });
  it("a stage needs the one before it", () => {
    expect(canComplete(piece(1, 0), "CUTTING")).toBe(true);
    expect(canComplete(piece(1, 0), "WELDING")).toBe(false);
    expect(canComplete(piece(1, 1), "ASSEMBLY")).toBe(true);
    expect(canComplete(piece(1, 1), "CUTTING")).toBe(false); // already done
  });
  it("only the latest finished stage can be undone", () => {
    expect(canUndo(piece(1, 2), "ASSEMBLY")).toBe(true);
    expect(canUndo(piece(1, 2), "CUTTING")).toBe(false);
    expect(canUndo(piece(1, 0), "CUTTING")).toBe(false);
  });
  it("knows what a piece waits for", () => {
    expect(nextStage(piece(1, 0))).toBe("CUTTING");
    expect(nextStage(piece(1, 2))).toBe("WELDING");
    expect(nextStage(piece(1, 4))).toBeNull();
    expect(lastDoneStage(piece(1, 2))).toBe("ASSEMBLY");
    expect(lastDoneStage(piece(1, 0))).toBeNull();
  });
});

describe("workOrderStats", () => {
  it("counts per stage and weighs the order", () => {
    const s = workOrderStats([piece(1, 4), piece(2, 2), piece(3, 0), piece(4, 0)], 50);
    expect(s.done).toEqual({ CUTTING: 2, ASSEMBLY: 2, WELDING: 1, PAINTING: 1 });
    expect(s.progress).toBe(37.5); // (100 + 50 + 0 + 0) / 4
    expect(s.totalKg).toBe(200);
    expect(s.producedKg).toBe(75);
  });
  it("an empty order is zero", () => expect(workOrderStats([], 10)).toMatchObject({ pieces: 0, progress: 0, totalKg: 0 }));
});

describe("pickEligible", () => {
  const pieces = [piece(3, 1), piece(1, 1), piece(2, 0), piece(4, 1)];
  it("takes the lowest numbers that are ready for the stage", () => {
    expect(pickEligible(pieces, "ASSEMBLY", 2).map((p) => p.seq)).toEqual([1, 3]);
    expect(pickEligible(pieces, "CUTTING", 5).map((p) => p.seq)).toEqual([2]);
    expect(pickEligible(pieces, "WELDING", 5)).toEqual([]);
    expect(pickEligible(pieces, "ASSEMBLY", 0)).toEqual([]);
  });
});

describe("projectProduction", () => {
  const orders = [
    { unitWeightKg: 100, pieces: [piece(1, 4), piece(2, 4)] }, // 200 kg, finished
    { unitWeightKg: 50, pieces: [piece(1, 2), piece(2, 0)] }, // 100 kg, 25 kg made
  ];
  it("counts the whole project's weight as the denominator", () => {
    const p = projectProduction(orders, 1000);
    expect(p.producedKg).toBe(225);
    expect(p.percent).toBe(22.5);
    expect(p.unplannedKg).toBe(700);
    expect(p.byStageKg).toEqual({ CUTTING: 250, ASSEMBLY: 250, WELDING: 200, PAINTING: 200 });
  });
  it("never goes above 100 and never below the weight that has orders", () => {
    const p = projectProduction(orders, 100); // takeoff weight smaller than the orders (parts edited later)
    expect(p.totalKg).toBe(300);
    expect(p.percent).toBe(75);
    expect(p.unplannedKg).toBe(0);
  });
  it("is zero without orders or weight", () => expect(projectProduction([], 0)).toMatchObject({ percent: 0, producedKg: 0 }));
});

describe("QR codes", () => {
  it("round-trips a piece code", () => {
    expect(pieceCode("WO-2026-0001", 7)).toBe("WO-2026-0001-007");
    expect(parsePieceCode("WO-2026-0001-007")).toEqual({ number: "WO-2026-0001", seq: 7 });
    expect(parsePieceCode(" wo-2026-0012-120 ")).toEqual({ number: "WO-2026-0012", seq: 120 });
  });
  it("rejects anything else", () => {
    for (const bad of ["", "PO-2026-0001-001", "WO-2026-0001", "WO-26-0001-001", "WO-2026-0001-x"]) expect(parsePieceCode(bad)).toBeNull();
  });
});

describe("descendantWbsIds", () => {
  it("takes the node and everything below it", () => {
    const wbs = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }, { id: "d", parentId: null }, { id: "e", parentId: "d" }];
    expect([...descendantWbsIds(wbs, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...descendantWbsIds(wbs, "d")].sort()).toEqual(["d", "e"]);
  });
});

describe("unitWeight", () => {
  it("divides the part's weight by its quantity", () => {
    expect(unitWeight(240, 4)).toBe(60);
    expect(unitWeight(240, 0)).toBe(0);
  });
});
