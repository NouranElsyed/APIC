import { describe, expect, it } from "vitest";
import { makeSettings, rotBox, rotList, soloRot, whyNotNested, type Group, type Pt } from "../nest-boost/engine";
import { FIT_LABEL, classifyAll, classifyFit } from "./fit";

const S = (over: Partial<{ W: number; H: number; mg: number; ro: number }> = {}) =>
  makeSettings({ W: 6000, H: 1500, mg: 5, gp: 5, cell: 5, ro: 2, ...over });

/** Part from outline points (translated so its bounding box starts at 0,0, like the DXF import does). */
function part(id: number, outer: Pt[], extra: Partial<Group> = {}): Group {
  const x0 = Math.min(...outer.map((p) => p[0]));
  const y0 = Math.min(...outer.map((p) => p[1]));
  const pts = outer.map(([x, y]) => [x - x0, y - y0] as Pt);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += (x1 * y2 - x2 * y1) / 2;
  }
  const w = Math.max(...pts.map((p) => p[0]));
  const h = Math.max(...pts.map((p) => p[1]));
  return { id, sn: id, name: `p${id}`, qty: 1, th: 10, material: "S235", outer: pts, holes: [], w, h, area: Math.abs(a), per: 2 * (w + h), ...extra };
}
const rect = (w: number, h: number) => part(1, [[0, 0], [w, 0], [w, h], [0, h]]);
const circle = (d: number, n = 72) =>
  part(2, Array.from({ length: n }, (_, i) => [(d / 2) * Math.cos((2 * Math.PI * i) / n), (d / 2) * Math.sin((2 * Math.PI * i) / n)] as Pt));
/** Thin bar L × W rotated by `deg` degrees. */
const bar = (L: number, W: number, deg: number) => {
  const t = (deg * Math.PI) / 180;
  const pts: Pt[] = [[0, 0], [L, 0], [L, W], [0, W]];
  return part(3, pts.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)] as Pt));
};

describe("classifyFit — the four states", () => {
  it("READY when it fits inside the margins", () => {
    const r = classifyFit(rect(3000, 1000), S());
    expect(r.status).toBe("READY");
    expect(r.label).toBe(FIT_LABEL.READY);
    expect(r.rot).toBe(0);
    expect(r.sheetIndex).toBe(0);
  });

  it("READY_SOLO when it fits only the raw sheet (same rule as the engine)", () => {
    const g = rect(5995, 1495); // usable area is 5990 × 1490
    const r = classifyFit(g, S());
    expect(r.status).toBe("READY_SOLO");
    expect(soloRot(g, S(), rotList(2))).not.toBeNull();
    expect(r.rot).toBe(soloRot(g, S(), rotList(2)));
  });

  it("NEEDS_SEGMENTATION when it exceeds the raw sheet at every rotation", () => {
    const r = classifyFit(rect(7000, 1000), S());
    expect(r.status).toBe("NEEDS_SEGMENTATION");
    expect(r.detail).toContain("7000 × 1000");
    expect(r.detail).toContain("can be split");
  });

  it("is never UNPLACEABLE just because it is oversized", () => {
    for (const g of [rect(9000, 9000), circle(7520), rect(100000, 10)]) {
      expect(classifyFit(g, S()).status).toBe("NEEDS_SEGMENTATION");
    }
  });

  it("UNPLACEABLE for an invalid sheet", () => {
    expect(classifyFit(rect(100, 100), S({ W: 0 })).reason).toBe("INVALID_SHEET");
    expect(classifyFit(rect(100, 100), S({ H: NaN })).status).toBe("UNPLACEABLE");
    expect(classifyFit(rect(100, 100), S(), { sheets: [{ W: -1, H: 1500 }] }).reason).toBe("INVALID_SHEET");
  });

  it("UNPLACEABLE for invalid geometry", () => {
    const g = { ...rect(100, 100), w: 0 };
    expect(classifyFit(g, S()).reason).toBe("INVALID_GEOMETRY");
    expect(classifyFit({ ...rect(100, 100), outer: [[0, 0], [1, 1]] }, S()).reason).toBe("INVALID_GEOMETRY");
  });

  it("an oversized pair of triangles is told to un-pair, not segmented", () => {
    const r = classifyFit({ ...rect(7000, 500), n: 2 }, S());
    expect(r.status).toBe("UNPLACEABLE");
    expect(r.reason).toBe("PAIRED_TRIANGLES");
    expect(r.detail).toContain("Auto-pair");
  });
});

describe("classifyFit — real geometry and rotation, not the unrotated bounding box", () => {
  it("rotation decides the fit (1000 × 5900 bar)", () => {
    const g = rect(1000, 5900);
    expect(classifyFit(g, S({ ro: 0 })).status).toBe("NEEDS_SEGMENTATION");
    expect(classifyFit(g, S({ ro: 1 })).status).toBe("NEEDS_SEGMENTATION");
    const r = classifyFit(g, S({ ro: 2 }));
    expect(r.status).toBe("READY");
    expect(r.rot).toBe(90);
  });

  it("suggests an existing rotation setting when that is enough (diagonal bar)", () => {
    const g = bar(5000, 200, 45); // bounding box ≈ 3677 × 3677, but the part itself is a thin bar
    expect(g.h).toBeGreaterThan(1490);
    const r = classifyFit(g, S({ ro: 2 }));
    expect(r.status).toBe("NEEDS_SEGMENTATION");
    expect(r.hint?.kind).toBe("ENABLE_ROTATION");
    if (r.hint?.kind === "ENABLE_ROTATION") {
      expect(r.hint.ro).toBe(3);
      const b = rotBox(g, r.hint.rot); // exactly the rotation the engine would try
      expect(b.w).toBeLessThanOrEqual(5990);
      expect(b.h).toBeLessThanOrEqual(1490);
    }
    expect(r.detail).toContain("45° steps");
    expect(classifyFit(g, S({ ro: 3 })).status).toBe("READY");
  });

  it("finds an angle no rotation setting offers (6100 × 50 bar, window ≈ 11.4°–13.7°)", () => {
    const g = rect(6100, 50);
    const r = classifyFit(g, S({ ro: 4 }));
    expect(r.status).toBe("NEEDS_SEGMENTATION");
    expect(r.hint?.kind).toBe("ANY_ANGLE");
    if (r.hint?.kind === "ANY_ANGLE") {
      expect(r.hint.solo).toBe(false);
      expect(r.hint.angle).toBeGreaterThanOrEqual(11);
      expect(r.hint.angle).toBeLessThanOrEqual(14);
    }
  });

  it("has no hint when no angle can fit it", () => {
    expect(classifyFit(rect(9000, 9000), S()).hint).toBeUndefined();
    expect(classifyFit(circle(7520), S({ ro: 4 })).hint).toBeUndefined();
  });

  it("circle: Ø1400 fits, Ø1495 is solo, Ø7520 needs segmentation", () => {
    expect(classifyFit(circle(1400), S()).status).toBe("READY");
    expect(classifyFit(circle(1495), S()).status).toBe("READY_SOLO");
    expect(classifyFit(circle(7520), S()).status).toBe("NEEDS_SEGMENTATION");
  });

  it("counts the part's extra rings (auto-paired triangles) in the size and in the hints", () => {
    // like the engine's pair builder: w/h already cover every ring
    const g = rect(1000, 500);
    g.extra = [[[5000, 0], [8000, 0], [8000, 100], [5000, 100]]];
    g.w = 8000;
    const r = classifyFit(g, S());
    expect(r.status).toBe("NEEDS_SEGMENTATION");
    expect(r.detail).toContain("8000 × 500");
    // rotated sizes use the extra ring too: at 45° the two rings span far more than the sheet height
    expect(rotBox(g, 45).h).toBeGreaterThan(1490);
  });
});

describe("classifyFit — sheet sizes and margins", () => {
  it("respects the configured margin", () => {
    const g = rect(5900, 1400);
    expect(classifyFit(g, S({ mg: 5 })).status).toBe("READY");
    expect(classifyFit(g, S({ mg: 60 })).status).toBe("READY_SOLO"); // usable 5880 × 1380 → raw sheet only
    expect(classifyFit(g, S({ mg: 0 })).status).toBe("READY");
  });

  it("user-defined sheet size", () => {
    const g = rect(7000, 1000);
    expect(classifyFit(g, S({ W: 8000 })).status).toBe("READY");
    expect(classifyFit(g, S({ W: 6000 })).status).toBe("NEEDS_SEGMENTATION");
  });

  it("tests several source sheets and reports which one fits", () => {
    const sheets = [{ W: 6000, H: 1500 }, { W: 8000, H: 2000 }];
    const r = classifyFit(rect(7000, 1000), S(), { sheets });
    expect(r.status).toBe("READY");
    expect(r.sheetIndex).toBe(1);
    expect(classifyFit(rect(3000, 1000), S(), { sheets }).sheetIndex).toBe(0);
    expect(classifyFit(rect(9000, 1000), S(), { sheets }).status).toBe("NEEDS_SEGMENTATION");
  });

  it("a normal fit on any sheet wins over a solo fit on an earlier one", () => {
    const g = rect(5995, 1000); // sheet 0: solo only; sheet 1: fits normally
    const r = classifyFit(g, S(), { sheets: [{ W: 6000, H: 1500 }, { W: 7000, H: 1500 }] });
    expect(r.status).toBe("READY");
    expect(r.sheetIndex).toBe(1);
  });

  it("keeps original sheet indexes when an invalid sheet is skipped", () => {
    const r = classifyFit(rect(100, 100), S(), { sheets: [{ W: 0, H: 0 }, { W: 6000, H: 1500 }] });
    expect(r.status).toBe("READY");
    expect(r.sheetIndex).toBe(1);
  });
});

describe("agreement with the engine", () => {
  it("READY / READY_SOLO / NEEDS match soloRot and the usable-area test on 400 random parts", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const counts = { READY: 0, READY_SOLO: 0, NEEDS_SEGMENTATION: 0, UNPLACEABLE: 0 };
    for (let i = 0; i < 400; i++) {
      const ro = Math.floor(rnd() * 5);
      const s = S({ W: 1000 + Math.floor(rnd() * 6000), H: 800 + Math.floor(rnd() * 2000), mg: Math.floor(rnd() * 60), ro });
      const g = rect(100 + rnd() * 7000, 20 + rnd() * 2500);
      const R = rotList(ro);
      const usable = R.some((r) => {
        const b = rotBox(g, r);
        return b.w <= s.W - 2 * s.mg + 0.01 && b.h <= s.H - 2 * s.mg + 0.01;
      });
      const solo = soloRot(g, s, R) !== null;
      const r = classifyFit(g, s);
      counts[r.status]++;
      expect(r.status).toBe(usable ? "READY" : solo ? "READY_SOLO" : "NEEDS_SEGMENTATION");
    }
    // the sample really exercises all three placeable/oversized states
    expect(counts.READY).toBeGreaterThan(20);
    expect(counts.READY_SOLO).toBeGreaterThan(0);
    expect(counts.NEEDS_SEGMENTATION).toBeGreaterThan(20);
    expect(counts.UNPLACEABLE).toBe(0);
  });

  it("for NEEDS_SEGMENTATION the engine's own explanation also says it cannot be placed", () => {
    const g = rect(7000, 1000);
    expect(classifyFit(g, S()).status).toBe("NEEDS_SEGMENTATION");
    expect(whyNotNested(g, S())).toMatch(/larger than the usable sheet area/);
  });
});

describe("classifyAll", () => {
  it("returns a result per group id", () => {
    const a = { ...rect(3000, 1000), id: 10 };
    const b = { ...rect(7000, 1000), id: 11 };
    const m = classifyAll([a, b], S());
    expect(m.get(10)?.status).toBe("READY");
    expect(m.get(11)?.status).toBe("NEEDS_SEGMENTATION");
    expect(m.size).toBe(2);
  });
});
