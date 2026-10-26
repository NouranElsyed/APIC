import { describe, expect, it } from "vitest";
import { addSource, addSourceLengths, parseSourceLengths, runOptimize1D, type Counters1D, type Piece1D, type Settings1D } from "./engine";

const S: Settings1D = {
  kerf: 0, leftTrim: 0, rightTrim: 0, gripping: 0, minimizeLayoutCount: false, maxPartsInLayout: 0,
  maxDistinctLengthsInLayout: 0, minLengthDiffInLayout: 0, remnantMinLength: 300, restrictedRestFrom: 0, restrictedRestTo: 0,
};
const counters = (): Counters1D => ({ id: 100000, sn: 0 });

describe("parseSourceLengths", () => {
  it("reads many lengths, with optional counts", () => {
    const r = parseSourceLengths("6000, 9000x10; 12000*2\n7500.5 4500×3", null);
    expect(r.invalid).toEqual([]);
    expect(r.items).toEqual([
      { length: 6000, qty: null }, { length: 9000, qty: 10 }, { length: 12000, qty: 2 }, { length: 7500.5, qty: null }, { length: 4500, qty: 3 },
    ]);
  });
  it("uses the default count for lengths without one", () => {
    expect(parseSourceLengths("6000 9000x1", 5).items).toEqual([{ length: 6000, qty: 5 }, { length: 9000, qty: 1 }]);
  });
  it("reports what it cannot read", () => {
    const r = parseSourceLengths("6000 abc 0 5000x0 -3", null);
    expect(r.items).toEqual([{ length: 6000, qty: null }]);
    expect(r.invalid).toEqual(["abc", "0", "5000x0", "-3"]);
  });
});

describe("addSourceLengths", () => {
  const c = counters();
  it("adds one source per length for the profile + material", () => {
    const out = addSourceLengths([], { profile: "IPE200", material: "S235", lengths: [{ length: 6000, qty: null }, { length: 12000, qty: 4 }], cost: 0 }, c);
    expect(out.map((x) => [x.length, x.qty, x.profile, x.material])).toEqual([[6000, null, "IPE200", "S235"], [12000, 4, "IPE200", "S235"]]);
    expect(new Set(out.map((x) => x.id)).size).toBe(2);
  });
  it("fills the blank row that import created before adding new ones", () => {
    const blank = addSource([], { profile: "IPE200", material: "S235", length: 0, qty: null, cost: 0, description: "" }, c);
    const out = addSourceLengths(blank, { profile: " ipe200 ", material: "s235", lengths: [{ length: 6000, qty: null }, { length: 9000, qty: null }], cost: 0 }, c);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(blank[0].id);
    expect(out.map((x) => x.length)).toEqual([6000, 9000]);
  });
  it("merges a length that is already there, and leaves other lots alone", () => {
    let list = addSourceLengths([], { profile: "A", material: "", lengths: [{ length: 6000, qty: 2 }], cost: 0 }, c);
    list = addSourceLengths(list, { profile: "B", material: "", lengths: [{ length: 6000, qty: 1 }], cost: 0 }, c);
    list = addSourceLengths(list, { profile: "A", material: "", lengths: [{ length: 6000, qty: 3 }], cost: 0 }, c);
    expect(list.map((x) => [x.profile, x.qty])).toEqual([["A", 5], ["B", 1]]);
    list = addSourceLengths(list, { profile: "A", material: "", lengths: [{ length: 6000, qty: null }], cost: 0 }, c);
    expect(list[0].qty).toBeNull();
  });
  it("many different lengths are all used by the optimizer", () => {
    const sources = addSourceLengths([], { profile: "P", material: "", lengths: [{ length: 3000, qty: 1 }, { length: 5000, qty: 1 }, { length: 9000, qty: 1 }], cost: 0 }, c);
    const pieces: Piece1D[] = [
      { id: 1, sn: 1, name: "a", profile: "P", material: "", length: 8800, qty: 1 },
      { id: 2, sn: 2, name: "b", profile: "P", material: "", length: 4900, qty: 1 },
      { id: 3, sn: 3, name: "c", profile: "P", material: "", length: 2900, qty: 1 },
    ];
    const res = runOptimize1D(pieces, sources, S);
    expect(res.skip).toEqual([]);
    expect(res.usedSources.map((u) => u.length).sort((a, b) => a - b)).toEqual([3000, 5000, 9000]);
  });
});
