import { describe, expect, it } from "vitest";
import { isExact, resizeGroup, type Group } from "./engine";
import { patchGroup } from "../segmentation/commit";

const g = (o: Partial<Group>): Group => ({ id: 1, sn: 1, name: "p", qty: 1, th: 10, material: "", outer: [[0, 0], [100, 0], [100, 50], [0, 50]], holes: [], w: 100, h: 50, area: 5000, per: 300, ...o });
const typed = { kind: "rect", w: 100, h: 50 } as never;

describe("isExact", () => {
  it("defaults: DXF parts exact, typed-in shapes approximate", () => {
    expect(isExact(g({}))).toBe(true);
    expect(isExact(g({ shape: typed }))).toBe(false);
  });
  it("an explicit choice wins", () => {
    expect(isExact(g({ exact: false }))).toBe(false);
    expect(isExact(g({ shape: typed, exact: true }))).toBe(true);
  });
});

describe("resizeGroup", () => {
  it("keeps a typed-in part approximate after it is stretched", () => {
    expect(isExact(resizeGroup(g({ shape: typed }), 200, 50))).toBe(false);
  });
  it("keeps an exact part exact", () => expect(isExact(resizeGroup(g({}), 200, 50))).toBe(true));
});

describe("patchGroup", () => {
  it("passes the exact flag from a segmented original to its pieces", () => {
    const seg = (role: "parent" | "child", extra: object = {}) => ({ role, planId: "p", ...extra }) as never;
    const gs = [g({ id: 1, seg: seg("parent", { childIds: [2] }) }), g({ id: 2, seg: seg("child", { parentId: 1 }) })];
    const out = patchGroup(gs, 1, { exact: false });
    expect(out.map((x) => isExact(x))).toEqual([false, false]);
  });
  it("ignores the flag edited on a piece (it follows its original)", () => {
    const seg = (role: "parent" | "child", extra: object = {}) => ({ role, planId: "p", ...extra }) as never;
    const gs = [g({ id: 1, seg: seg("parent", { childIds: [2] }) }), g({ id: 2, seg: seg("child", { parentId: 1 }) })];
    expect(patchGroup(gs, 2, { exact: false })).toBe(gs);
  });
});
