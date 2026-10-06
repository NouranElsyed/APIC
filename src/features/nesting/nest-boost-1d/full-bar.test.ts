import { describe, expect, it } from "vitest";
import { barStats, barTrims, minBarLength, runOptimize1D, type Piece1D, type Settings1D, type Source1D } from "./engine";

const S: Settings1D = {
  kerf: 3, leftTrim: 10, rightTrim: 10, gripping: 5, minimizeLayoutCount: false, maxPartsInLayout: 0,
  maxDistinctLengthsInLayout: 0, minLengthDiffInLayout: 0, remnantMinLength: 0, restrictedRestFrom: 0, restrictedRestTo: 0,
};
const src = (id: number, length: number, qty: number | null = null): Source1D =>
  ({ id, sn: id, profile: "IPE200", material: "st37", length, qty, cost: 0, description: "" }) as Source1D;
const piece = (id: number, length: number, qty: number): Piece1D =>
  ({ id, sn: id, name: `p${id}`, profile: "IPE200", material: "st37", length, qty }) as Piece1D;

describe("a piece as long as the bar gets a bar of its own with no trims", () => {
  it("12000 mm piece on a 12000 mm bar: cut at 0, no trim / gripping, nothing else on it", () => {
    const r = runOptimize1D([piece(1, 12000, 1), piece(2, 500, 2)], [src(1, 12000)], S);
    expect(r.skip).toHaveLength(0);
    const full = r.layouts.flatMap((l) => l.bars).filter((b) => b.full);
    expect(full).toHaveLength(1);
    expect(full[0].cuts).toHaveLength(1);
    expect(full[0].cuts[0].pos).toBe(0);
    expect(barTrims(full[0], S)).toEqual({ left: 0, right: 0 });
    expect(barStats(full[0], S).rest).toBe(0);
    expect(minBarLength(full[0], S)).toBe(12000);
    const normal = r.layouts.flatMap((l) => l.bars).filter((b) => !b.full);
    expect(normal).toHaveLength(1);
    expect(normal[0].cuts).toHaveLength(2);
    expect(barTrims(normal[0], S)).toEqual({ left: 10, right: 15 });
  });

  it("a piece that fits the trimmed bar is cut normally", () => {
    const r = runOptimize1D([piece(1, 11900, 1)], [src(1, 12000)], S);
    expect(r.layouts[0].bars[0].full).toBeUndefined();
  });

  it("a piece longer than the raw bar is still skipped", () => {
    const r = runOptimize1D([piece(1, 12001, 1)], [src(1, 12000)], S);
    expect(r.skip).toHaveLength(1);
    expect(r.layouts).toHaveLength(0);
  });

  it("respects limited stock for full-length bars", () => {
    const r = runOptimize1D([piece(1, 12000, 2)], [src(1, 12000, 1)], S);
    expect(r.layouts.flatMap((l) => l.bars)).toHaveLength(1);
    expect(r.skip).toHaveLength(1);
  });
});
