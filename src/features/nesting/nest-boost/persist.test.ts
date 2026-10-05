import { describe, expect, it } from "vitest";
import type { Group, OptResult } from "./engine";
import { decodeSnapshot, encodeSnapshot } from "./persist";

const g = (id: number): Group => ({
  id, sn: id, name: `P${id}`, qty: 2, th: 10, material: "S235",
  outer: [[0, 0], [100, 0], [100, 50], [0, 50]], holes: [], w: 100, h: 50, area: 5000, per: 300,
});

describe("2D nest snapshot", () => {
  it("round-trips a result without storing the grid and keeps part sharing", () => {
    const a = g(1), b = g(2);
    const result: OptResult = {
      sheets: [{ th: 10, material: "S235", used: 2, grid: new Uint8Array(4), items: [{ g: a, rot: 0, x: 5, y: 5 }, { g: a, rot: 90, x: 120, y: 5 }] }],
      un: [b], skip: [],
    };
    const snap = encodeSnapshot({
      cfg: { W: "6000", H: "1500", mg: "5", gp: "5", cell: "5", ro: "2", tm: "20", pair: true, common: false },
      units: "1", groups: [a], counters: { id: 2, sn: 2 }, savedSeq: 0, importedIds: ["x"], result, resS: null, savedNests: [], activeNestId: null,
    });
    const json = JSON.parse(JSON.stringify(snap));
    expect(JSON.stringify(json)).not.toContain("grid");
    expect(json.extra.map((x: Group) => x.id)).toEqual([2]); // b only lives in `un`
    const back = decodeSnapshot(json)!;
    expect(back.result!.sheets[0].items).toHaveLength(2);
    expect(back.result!.sheets[0].items[0].g).toBe(back.groups[0]);
    expect(back.result!.un[0].id).toBe(2);
    expect(back.importedIds).toEqual(["x"]);
  });

  it("rejects unknown payloads", () => {
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot({ v: 2 })).toBeNull();
  });
});
