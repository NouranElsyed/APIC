import { coneFlat, cylPartFlat, type Group, type ManualShape, type Pt } from "./engine";

/** How a part's outline and area are worked out, as lines of text with the real numbers filled in. */
export interface ShapeFormula {
  /** "Rectangle", "Cone (flat pattern)" ... */
  title: string;
  /** Short lines: what the flat pattern is, then each formula step. */
  steps: string[];
  /** The area the formula gives for the outline minus the typed-in hole (mm²); null when it cannot be worked out. */
  formulaMm2: number | null;
  /** Where the shape came from: typed in with its dimensions, or recognised from the drawing. */
  source: "typed" | "detected";
}

export interface HoleLine {
  count: number;
  /** Diameter in mm; null = not a round hole. */
  d: number | null;
  /** Area of ONE such hole (mm²). */
  each: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const f0 = (n: number) => Math.round(n).toLocaleString();
const circ = (d: number) => (Math.PI * d * d) / 4;
const holeStep = (d: number) => `Hole Ø${f(d)}: π × (${f(d)} / 2)² = ${f0(circ(d))} mm²`;

/** Formula of a part that was typed in with its dimensions. */
export function formulaFromShape(s: ManualShape): ShapeFormula | null {
  const hole = s.hole && s.hole > 0 ? s.hole : 0;
  const steps: string[] = [];
  let title: string;
  let base: number;
  switch (s.kind) {
    case "rect":
      title = "Rectangle";
      base = s.w * s.h;
      steps.push(`Area = length × width = ${f(s.w)} × ${f(s.h)} = ${f0(base)} mm²`);
      break;
    case "circle":
      title = "Circle";
      base = circ(s.d);
      steps.push(`Area = π × r² = π × (${f(s.d)} / 2)² = ${f0(base)} mm²`);
      break;
    case "triangle": {
      title = "Triangle";
      const t = (s.angle * Math.PI) / 180;
      base = 0.5 * s.a * s.b * Math.sin(t);
      const third = Math.sqrt(s.a * s.a + s.b * s.b - 2 * s.a * s.b * Math.cos(t));
      steps.push(`Area = ½ × a × b × sin(angle) = ½ × ${f(s.a)} × ${f(s.b)} × sin(${f(s.angle)}°) = ${f0(base)} mm²`);
      steps.push(`Third side = √(a² + b² − 2·a·b·cos(angle)) = ${f(third)} mm`);
      break;
    }
    case "trapezoid":
      title = s.right ? "Right trapezoid" : "Trapezoid";
      base = ((s.a + s.b) / 2) * s.h;
      steps.push(`Area = (bottom + top) / 2 × height = (${f(s.a)} + ${f(s.b)}) / 2 × ${f(s.h)} = ${f0(base)} mm²`);
      break;
    case "cylinder":
      title = "Cylinder (flat pattern)";
      base = Math.PI * s.d * s.h;
      steps.push(`Unrolled, the cylinder is a rectangle: length = π × Ø = π × ${f(s.d)} = ${f(Math.PI * s.d)} mm, width = height = ${f(s.h)} mm`);
      steps.push(`Area = ${f(Math.PI * s.d)} × ${f(s.h)} = ${f0(base)} mm²`);
      break;
    case "cylpart": {
      title = "Cylinder part (flat pattern)";
      const c = cylPartFlat(s);
      if ("error" in c) return null;
      const i = c.info;
      steps.push(`Radius ${f(s.r)} mm covers ${f(i.angle)}° → arc length = r × angle = ${f(s.r)} × ${f(i.angle)}° × π / 180 = ${f(i.arc)} mm (chord ${f(i.chord)}, rise ${f(i.rise)})`);
      if (s.h2 !== undefined && !Number.isNaN(s.h2)) {
        base = ((s.h + s.h2) / 2) * c.len;
        steps.push(`Cut at a slant: the flat pattern is a trapezoid, heights ${f(s.h)} and ${f(s.h2)}`);
        steps.push(`Area = (h1 + h2) / 2 × arc = (${f(s.h)} + ${f(s.h2)}) / 2 × ${f(c.len)} = ${f0(base)} mm²`);
      } else {
        base = c.len * s.h;
        steps.push(`Area = arc × height = ${f(c.len)} × ${f(s.h)} = ${f0(base)} mm²`);
      }
      break;
    }
    case "cone": {
      title = s.d2 > 0 ? "Truncated cone (flat pattern)" : "Cone (flat pattern)";
      const c = coneFlat(s.d1, s.d2, s.h);
      if ("error" in c) return null;
      steps.push(`Slant = √(h² + ((Ø1 − Ø2) / 2)²) = √(${f(s.h)}² + ${f((s.d1 - s.d2) / 2)}²) = ${f(c.slant)} mm`);
      steps.push(`Outer radius R = slant × Ø1 / (Ø1 − Ø2) = ${f(c.slant)} × ${f(s.d1)} / ${f(s.d1 - s.d2)} = ${f(c.R)} mm`);
      steps.push(`Inner radius r = R − slant = ${f(c.r)} mm`);
      steps.push(`Opening angle = 180 × Ø1 / R = 180 × ${f(s.d1)} / ${f(c.R)} = ${f(c.angle)}°`);
      base = (c.angle / 360) * Math.PI * (c.R * c.R - c.r * c.r);
      steps.push(`Area = angle / 360 × π × (R² − r²) = ${f(c.angle)} / 360 × π × (${f(c.R)}² − ${f(c.r)}²) = ${f0(base)} mm²`);
      break;
    }
    case "arc":
      title = s.r > 0 ? "Arc (curved strip)" : "Pie slice";
      base = (s.angle / 360) * Math.PI * ((s.r + s.w) ** 2 - s.r * s.r);
      steps.push(`Outer radius = inner radius + width = ${f(s.r)} + ${f(s.w)} = ${f(s.r + s.w)} mm`);
      steps.push(`Area = angle / 360 × π × (R² − r²) = ${f(s.angle)} / 360 × π × (${f(s.r + s.w)}² − ${f(s.r)}²) = ${f0(base)} mm²`);
      break;
  }
  let total = base;
  if (hole) {
    steps.push(holeStep(hole));
    total = base - circ(hole);
    steps.push(`Net area = ${f0(base)} − ${f0(circ(hole))} = ${f0(total)} mm²`);
  }
  return { title, steps, formulaMm2: total, source: "typed" };
}

const polyArea = (p: Pt[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(s / 2);
};
const bbox = (p: Pt[]) => {
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/** A closed outline that is a round circle: its diameter, or null. */
export function circleDiameter(p: Pt[]): number | null {
  if (p.length < 16) return null;
  const { w, h } = bbox(p);
  if (!(w > 0) || Math.abs(w - h) > w * 0.01) return null;
  return Math.abs(polyArea(p) - circ(w)) <= circ(w) * 0.01 ? (w + h) / 2 : null;
}

/** The holes of a part, round ones grouped by diameter ("4 × Ø20"). */
export function holeLines(holes: Pt[][]): HoleLine[] {
  const out: HoleLine[] = [];
  for (const h of holes) {
    const d = circleDiameter(h);
    const key = d === null ? null : Math.round(d * 10) / 10;
    const found = out.find((x) => (key === null ? false : x.d === key));
    if (found) found.count++;
    else out.push({ count: 1, d: key, each: d === null ? polyArea(h) : circ(d) });
  }
  return out;
}

/** What can be recognised from the outline alone (a part from a DXF, or one that was stretched). */
export function formulaFromGeometry(g: Group): ShapeFormula | null {
  const box = g.w * g.h;
  const holesMm2 = g.holes.reduce((s, h) => s + polyArea(h), 0);
  const outline = g.area + holesMm2;
  const steps: string[] = [];
  let title: string | null = null;
  const d = circleDiameter(g.outer);
  if (g.outer.length === 4 && Math.abs(outline - box) <= box * 0.001) {
    title = "Rectangle";
    steps.push(`Area = length × width = ${f(g.w)} × ${f(g.h)} = ${f0(box)} mm²`);
  } else if (d !== null) {
    title = "Circle";
    steps.push(`Area = π × r² = π × (${f(d)} / 2)² = ${f0(circ(d))} mm²`);
  }
  if (!title) return null;
  const base = d !== null ? circ(d) : box;
  let total = base;
  for (const h of holeLines(g.holes)) {
    if (h.d === null) continue;
    steps.push(`${h.count} × ${holeStep(h.d)}`);
    total -= h.count * h.each;
  }
  if (g.holes.length) steps.push(`Net area = outline − holes = ${f0(total)} mm²`);
  return { title, steps, formulaMm2: total, source: "detected" };
}

/** The formula of a part, from its typed-in dimensions when it has them, else from its outline when it is a simple shape. */
export function shapeFormula(g: Group): ShapeFormula | null {
  return (g.shape ? formulaFromShape(g.shape) : null) ?? formulaFromGeometry(g);
}
