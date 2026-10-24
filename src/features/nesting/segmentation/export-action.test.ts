import { describe, expect, it } from "vitest";
import type { Group, Pt } from "../nest-boost/engine";
import { commitSegmentation, removeSegmentation } from "./commit";
import { exportSavedSegmentation, exportSegmentation } from "./export-action";
import { generateCandidates, type Plan } from "./planner";
import { groupToRegion } from "./group-region";
import { reportData } from "./report";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const plate = (qty = 3, name = "PLATE-001"): Group => ({ id: 1, sn: 1, name, qty, th: 10, material: "S235", outer: rect(12000, 2980), holes: [], w: 12000, h: 2980, area: 12000 * 2980, per: 1 });
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2, gp: 5, cell: 5 };
const bestPlan = (g: Group, mm = 0): Plan =>
  generateCandidates(groupToRegion(g).region, { directions: ["H", "V"], sheet: SHEET, overlap: { enabled: mm !== 0, mm, side: "alternate" }, holePolicy: "reject", allowSolo: false }).find((c) => c.plan.valid)!.plan;

/** Collects what would have been downloaded. */
function recorder() {
  const calls: { blob: Blob; name: string }[] = [];
  return { calls, save: (blob: Blob, name: string) => void calls.push({ blob, name }) };
}
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const has = (hay: Uint8Array, text: string) => new TextDecoder("latin1").decode(hay).includes(text);

describe("exportSegmentation", () => {
  it("downloads one zip with a DXF per piece, the assembly drawing and the report", async () => {
    const g = plate();
    const plan = bestPlan(g);
    const rec = recorder();
    const r = await exportSegmentation({ parent: g, original: groupToRegion(g).region, plan }, rec.save);
    expect(r).toEqual({ zipName: "PLATE-001-segmentation.zip", pieces: plan.segments.length, files: plan.segments.length + 2 });
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].name).toBe("PLATE-001-segmentation.zip");
    expect(rec.calls[0].blob.type).toBe("application/zip");
    const z = await bytes(rec.calls[0].blob);
    expect([z[0], z[1]]).toEqual([0x50, 0x4b]); // "PK"
    for (const s of plan.segments) expect(has(z, `PLATE-001-${s.id}.dxf`)).toBe(true);
    expect(has(z, "PLATE-001-assembly.dxf")).toBe(true);
    expect(has(z, "PLATE-001-segmentation-report.xlsx")).toBe(true);
  }, 30000);

  it("refuses a layout with errors and downloads nothing", async () => {
    const g = plate();
    const bad: Plan = { ...bestPlan(g), valid: false };
    const rec = recorder();
    await expect(exportSegmentation({ parent: g, original: groupToRegion(g).region, plan: bad }, rec.save)).rejects.toThrow(/errors/);
    expect(rec.calls).toHaveLength(0);
  });
});

describe("exportSavedSegmentation (an already segmented original)", () => {
  const segmented = (mm = 0) => {
    const g = plate(3);
    const r = commitSegmentation({ groups: [g], parentId: 1, plan: bestPlan(g, mm), counters: { id: 10, sn: 1 } });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };

  it("exports what was approved: same pieces, same sizes as the parts in the nest, quantity from the original", async () => {
    const r = segmented();
    const rec = recorder();
    const out = await exportSavedSegmentation(r.parent, rec.save);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.pieces).toBe(r.children.length);
    expect(out.result.zipName).toBe("PLATE-001-segmentation.zip");
    // the exported pieces are the nest's parts: same names, same sizes
    const z = await bytes(rec.calls[0].blob);
    for (const c of r.children) expect(has(z, `${c.name}.dxf`)).toBe(true);
    const rebuilt = reportData({ parent: r.parent, original: groupToRegion(r.parent).region, plan: bestPlan(plate(3)) }).pieces;
    expect(rebuilt.map((p) => p.name)).toEqual(r.children.map((c) => c.name));
    rebuilt.forEach((p, i) => {
      expect(p.cutW).toBeCloseTo(r.children[i].w, 2);
      expect(p.cutH).toBeCloseTo(r.children[i].h, 2);
      expect(p.qty).toBe(r.children[i].qty);
    });
  }, 30000);

  it("works the same after a save / load (the saved plan survives JSON) and with a gap", async () => {
    const r = segmented(-4);
    const reloaded: Group = JSON.parse(JSON.stringify(r.parent));
    const rec = recorder();
    const out = await exportSavedSegmentation(reloaded, rec.save);
    expect(out.ok).toBe(true);
    expect(rec.calls).toHaveLength(1);
  }, 30000);

  it("refuses with a reason: not segmented, changed since, or errors in the saved plan", async () => {
    const rec = recorder();
    const none = await exportSavedSegmentation(plate(), rec.save);
    expect(none).toEqual({ ok: false, reason: "This part has no saved segmentation." });

    const r = segmented();
    const changed = await exportSavedSegmentation({ ...r.parent, w: r.parent.w + 1 }, rec.save);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.reason).toMatch(/changed after it was segmented/);

    const plan = r.parent.seg!.plan as Plan["input"];
    const broken: Group = { ...r.parent, seg: { ...r.parent.seg!, plan: { ...plan, stripCuts: [...plan.stripCuts, { id: "Cx", pos: 99999 }] } } };
    const errs = await exportSavedSegmentation(broken, rec.save);
    expect(errs.ok).toBe(false);
    if (!errs.ok) expect(errs.reason).toMatch(/has errors/);

    const piece = await exportSavedSegmentation(r.children[0], rec.save);
    expect(piece.ok).toBe(false); // a piece has no plan of its own
    expect(removeSegmentation(r.groups, 1).groups[0].seg).toBeUndefined();
    expect(rec.calls).toHaveLength(0); // nothing was downloaded in any of these cases
  });
});
