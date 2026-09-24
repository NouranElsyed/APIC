// Minimal, dependency-free DXF (ASCII) parser scoped to what DXF Nesting
// actually needs: closed 2D plate/sheet profiles.
//
// Deliberately NOT a full DXF implementation — it reads the ENTITIES
// section and understands:
//   - closed LWPOLYLINE and POLYLINE+VERTEX, INCLUDING arc segments
//     encoded as `bulge` (group code 42),
//   - CIRCLE,
//   - LINE and ARC entities, which are chained end-to-end into closed loops
//     (a plate outline made of LINEs + ARCs — e.g. rounded corners — is the
//     most common CAD export).
// Everything else (layers, blocks, dimensions, text, SPLINE, ELLIPSE, etc.)
// is ignored — a DXF containing only unsupported entities is reported as
// invalid rather than silently guessed at.
//
// Contour hierarchy (Phase 0): closed loops are classified by containment
// depth, NOT by "largest loop = the part, everything else = hole".
//   depth 0 (not inside any loop)  → an independent OUTER contour (a part)
//   depth 1 (inside one outer)     → a HOLE of that outer
//   depth 2 (inside a hole)        → an independent part again (an island)
//   …and so on (even depth = part, odd depth = hole of its parent).
// `parts` carries every independent part with its own holes. The legacy
// single-part fields (`geometry`, `areaSqm`, …) are only populated when the
// file contains exactly ONE part; a multi-part file is reported as invalid
// (see parseDxf) instead of silently treating extra parts as holes.
//
// Arc tessellation (Phase 0): arcs are turned into polylines with a
// configurable maximum deviation (default DEFAULT_ARC_TOLERANCE_MM = 0.1 mm)
// and ALWAYS in the conservative direction for the loop's role, so that the
// material region described by (outer − holes) is never smaller than the
// real one:
//   - an OUTER contour's polygon is a superset of the true outline,
//   - a HOLE's polygon is a subset of the true hole.
// (Circumscribed/tangent vertices where the true boundary would otherwise
// be cut off; plain chords where chords already err on the safe side.)
//
// Known limitations (deliberately NOT guessed at):
//   - SPLINE and ELLIPSE entities are ignored (a loop that needs them is
//     reported as open / invalid rather than approximated).
//   - Entity extrusion directions other than +Z (group codes 210/220/230,
//     i.e. mirrored OCS) are not applied.
//   - Chained LINE/ARC endpoints are joined within LINE_CONNECTION_TOLERANCE_MM,
//     so a loop's vertices can differ from its arcs' exact end points by up
//     to that amount (0.05 mm).
//   - CIRCLE keeps its historical 64-vertex INSCRIBED tessellation (unchanged);
//     as a hole that is the conservative direction, but a lone CIRCLE used as
//     an outer contour is ~0.13 mm (r = 100 mm) smaller than the true disc.
//
// Critical rule (per spec): the outer/hole polygons below ARE the source
// of truth for area and future nesting. The bounding box is metadata
// only, never used to derive area or the nesting shape itself.

export interface Point {
  x: number;
  y: number;
}

export interface DxfPartGeometry {
  outer: Point[];
  holes: Point[][];
  areaSqm: number; // net area of THIS part = outer − its own holes, in m²
  bboxWidthMm: number;
  bboxHeightMm: number;
}

export interface ParseDxfOptions {
  /**
   * Maximum allowed deviation (mm) between a tessellated arc and the true
   * arc. Must be a finite number > 0. Defaults to DEFAULT_ARC_TOLERANCE_MM.
   */
  arcToleranceMm?: number;
}

export interface DxfGeometryResult {
  valid: boolean;
  errorMessage: string | null;
  unitsDetected: string; // human label, e.g. "mm", "in", "unitless (assumed mm)"
  areaSqm: number | null; // net area = outer − holes, already in m²
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
  outerContourCount: number;
  holeCount: number;
  unitsWarning: string | null; // set when bbox size looks implausible for the detected unit
  geometry: { outer: Point[]; holes: Point[][] } | null; // normalized to mm; only set when the file holds exactly ONE part
  /**
   * Every independent part found in the file, each with its own holes
   * (Phase 0 contour hierarchy). Empty when no closed geometry was found.
   * For a valid single-part file this has exactly one entry equal to
   * `geometry`.
   */
  parts: DxfPartGeometry[];
}

// DXF $INSUNITS codes → millimetres-per-unit. Anything not listed here
// (rare units, or code 0 = unitless) falls back to "assume mm", which is
// flagged clearly in `unitsDetected` rather than pretended away.
const UNIT_MM_FACTOR: Record<number, { factor: number; label: string }> = {
  1: { factor: 25.4, label: "in" },
  2: { factor: 304.8, label: "ft" },
  4: { factor: 1, label: "mm" },
  5: { factor: 10, label: "cm" },
  6: { factor: 1000, label: "m" },
  13: { factor: 0.001, label: "µm" },
  14: { factor: 100, label: "dm" },
};

// Sanity check, not a hard rule: real steel plate/sheet parts are almost
// always well under this size. If a part's bounding box comes out bigger
// than this AFTER unit conversion, it's a strong signal that $INSUNITS in
// the source DXF doesn't match what the drawing was actually authored in
// (e.g. coordinates drawn in mm but the file header says inches — see the
// 322.58 m² false-inch case). We flag it rather than silently trusting the
// header, and suggest which unit would bring it back into a sane range.
const SUSPECT_MAX_MM = 4000;

const ALT_UNIT_CANDIDATES: { label: string; factor: number }[] = [
  { label: "mm", factor: 1 },
  { label: "cm", factor: 10 },
  { label: "in", factor: 25.4 },
  { label: "ft", factor: 304.8 },
  { label: "m", factor: 1000 },
];

// bboxWidthMm/bboxHeightMm are already-converted values (using the unit
// factor detectUnits() chose). We reverse that conversion back to raw DXF
// units, then try each candidate unit to see which one would produce a
// plausible part size — so the message can suggest a concrete fix.
export function checkUnitsSanity(
  bboxWidthMm: number | null,
  bboxHeightMm: number | null,
  detectedLabel: string | null,
  appliedFactor: number
): string | null {
  if (!bboxWidthMm || !bboxHeightMm) return null;
  if (bboxWidthMm <= SUSPECT_MAX_MM && bboxHeightMm <= SUSPECT_MAX_MM) return null;

  const rawWidth = bboxWidthMm / appliedFactor;
  const rawHeight = bboxHeightMm / appliedFactor;

  const plausible = ALT_UNIT_CANDIDATES.find(
    (c) => c.label !== detectedLabel && rawWidth * c.factor <= SUSPECT_MAX_MM && rawHeight * c.factor <= SUSPECT_MAX_MM
  );

  if (plausible) {
    return `Unusually large part (${bboxWidthMm.toFixed(0)}×${bboxHeightMm.toFixed(0)} mm) — detected as "${detectedLabel}". ` +
      `If the drawing was actually made in "${plausible.label}", the real size would be about ` +
      `${(rawWidth * plausible.factor).toFixed(0)}×${(rawHeight * plausible.factor).toFixed(0)} mm. ` +
      `Check the $INSUNITS value in the DXF header.`;
  }

  return `Unusually large part (${bboxWidthMm.toFixed(0)}×${bboxHeightMm.toFixed(0)} mm) — please verify the DXF units before trusting this area.`;
}

// Tolerance for deciding two LINE endpoints are "the same point" for the
// purpose of chaining segments into a closed loop. Deliberately small and
// explicit (millimetres, post unit-conversion) — see spec's "IMPORTANT EDGE
// CASE": we must never connect points just because they look close at the
// current CAD zoom level.
export const LINE_CONNECTION_TOLERANCE_MM = 0.05;

interface Tag { code: number; value: string; }

function tokenize(text: string): Tag[] {
  const lines = text.split(/\r\n|\r|\n/);
  const tags: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1] ?? "";
    if (Number.isNaN(code)) continue;
    tags.push({ code, value: value.trim() });
  }
  return tags;
}

function shoelaceArea(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function detectUnits(tags: Tag[]): { factor: number; label: string } {
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 9 && tags[i].value.toUpperCase() === "$INSUNITS") {
      // The value is on the next 70-code tag.
      for (let j = i + 1; j < Math.min(i + 4, tags.length); j++) {
        if (tags[j].code === 70) {
          const code = parseInt(tags[j].value, 10);
          const known = UNIT_MM_FACTOR[code];
          return known ?? { factor: 1, label: "unitless (assumed mm)" };
        }
      }
    }
  }
  return { factor: 1, label: "unitless (assumed mm)" };
}

// Isolates the ENTITIES section so HEADER/TABLES/BLOCKS content (which can
// also contain 0/SECTION-style group codes) never leaks in.
function getEntitiesSection(tags: Tag[]): Tag[] {
  let start = -1, end = tags.length;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 2 && tags[i].value.toUpperCase() === "ENTITIES") { start = i; continue; }
    if (start >= 0 && tags[i].code === 0 && tags[i].value.toUpperCase() === "ENDSEC") { end = i; break; }
  }
  if (start < 0) return [];
  return tags.slice(start, end);
}

// ---------------------------------------------------------------------------
// Arc / bulge geometry
// ---------------------------------------------------------------------------

/** Default maximum deviation (mm) between a tessellated arc and the true arc. */
export const DEFAULT_ARC_TOLERANCE_MM = 0.1;

// A single tessellation step never spans more than this, whatever the
// tolerance says. Keeps the tangent (circumscribed) vertex radius
// r / cos(step / 2) finite and well-conditioned even for absurdly loose
// tolerances.
const MAX_ARC_STEP_RAD = Math.PI / 3;

// Hard safety cap on segments per arc (a nonsensically tiny tolerance on a
// huge radius must not be able to blow up memory).
const MAX_SEGMENTS_PER_ARC = 4096;

// CIRCLE entities keep their pre-Phase-0 tessellation exactly: 64 vertices
// on the circle, starting at angle 0, counter-clockwise.
const CIRCLE_SEGMENTS = 64;

// Loops smaller than this (mm²) are degenerate (collinear / zero-area) and
// are ignored rather than allowed to become phantom "parts".
const MIN_LOOP_AREA_MM2 = 1e-6;

// Tolerance (mm) for "point lies on a polygon boundary" in containment tests.
const BOUNDARY_EPS_MM = 1e-6;

/**
 * One circular arc edge, described in TRAVERSAL direction: it starts at the
 * loop vertex it is attached to (angle `a0` about the centre) and sweeps
 * `sweep` radians (signed: > 0 counter-clockwise, < 0 clockwise) to reach
 * the next vertex.
 */
interface ArcEdge {
  cx: number;
  cy: number;
  r: number;
  a0: number;
  sweep: number;
}

/**
 * A closed loop before tessellation: `vertices[i]` → `vertices[i+1]`
 * (wrapping) is a straight edge when `arcs[i]` is null, otherwise a circular
 * arc. Keeping arcs symbolic until the loop's ROLE (outer vs hole) is known
 * is what lets tessellation pick the conservative direction per role.
 */
interface RawLoop {
  vertices: Point[];
  arcs: (ArcEdge | null)[];
}

type LoopRole = "outer" | "hole";

function pointOnArc(edge: ArcEdge, angle: number, radius: number = edge.r): Point {
  return { x: edge.cx + radius * Math.cos(angle), y: edge.cy + radius * Math.sin(angle) };
}

/**
 * Largest angular step (radians) such that BOTH the inscribed (chord) and
 * the circumscribed (tangent) approximation stay within `tolMm` of the true
 * arc. For a circumscribed step Δ the worst deviation is r·(sec(Δ/2) − 1);
 * solving r·(sec(x) − 1) = tol with t = tol/r gives tan²x = t² + 2t.
 * (The chord sagitta r·(1 − cos(Δ/2)) is always smaller than that, so one
 * bound covers both.)
 */
function maxStepForTolerance(radius: number, tolMm: number): number {
  const t = tolMm / radius;
  const halfStep = Math.atan(Math.sqrt(t * t + 2 * t));
  return Math.min(2 * halfStep, MAX_ARC_STEP_RAD);
}

function segmentCountFor(edge: ArcEdge, tolMm: number): number {
  const step = maxStepForTolerance(edge.r, tolMm);
  const n = Math.ceil(Math.abs(edge.sweep) / step - 1e-9);
  return Math.min(MAX_SEGMENTS_PER_ARC, Math.max(1, n));
}

/**
 * Interior vertices for one arc edge (the loop's own vertices supply the
 * two end points, which are always exact).
 *
 *  - "chord":   points ON the arc — the inscribed polygon (n − 1 points).
 *  - "tangent": the circumscribed polygon: one vertex per sub-arc, at the
 *               intersection of the tangents at that sub-arc's two ends,
 *               i.e. radius r / cos(step/2) at the sub-arc's mid-angle
 *               (n points). Every polygon edge then lies on a tangent line,
 *               so the polygon never cuts inside the true arc.
 */
function arcInterior(edge: ArcEdge, mode: "chord" | "tangent", tolMm: number): Point[] {
  const n = segmentCountFor(edge, tolMm);
  const step = edge.sweep / n;
  const out: Point[] = [];
  if (mode === "chord") {
    for (let k = 1; k < n; k++) out.push(pointOnArc(edge, edge.a0 + step * k));
  } else {
    const tangentRadius = edge.r / Math.cos(step / 2);
    for (let k = 0; k < n; k++) out.push(pointOnArc(edge, edge.a0 + step * (k + 0.5), tangentRadius));
  }
  return out;
}

function tessellateLoop(loop: RawLoop, pick: (edge: ArcEdge) => "chord" | "tangent", tolMm: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < loop.vertices.length; i++) {
    out.push(loop.vertices[i]);
    const arc = loop.arcs[i];
    if (arc) out.push(...arcInterior(arc, pick(arc), tolMm));
  }
  return out;
}

/** Polygon with vertices ON every arc — used for classification (area, containment, orientation). */
function referencePolygon(loop: RawLoop, tolMm: number): Point[] {
  return tessellateLoop(loop, () => "chord", tolMm);
}

function signedArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * The FINAL polygon for a loop once its role is known — conservative w.r.t.
 * the material region:
 *   outer → polygon ⊇ the loop's true interior,
 *   hole  → polygon ⊆ the loop's true interior (so material ⊇ real).
 *
 * Per arc: the boundary is CONVEX (as seen from the loop's interior) when the
 * arc's centre is on the interior side. A counter-clockwise loop has its
 * interior on the LEFT of travel, and a counter-clockwise arc (sweep > 0) has
 * its centre on the left, so convex ⇔ (loop is CCW) == (sweep > 0).
 *   - convex + want superset (outer)   → tangent (circumscribed) points
 *   - convex + want subset   (hole)    → chords
 *   - concave + want superset (outer)  → chords
 *   - concave + want subset  (hole)    → tangent points
 * i.e. tangent iff (convex === wantSuperset).
 */
function conservativePolygon(loop: RawLoop, role: LoopRole, tolMm: number): Point[] {
  const loopIsCcw = signedArea(referencePolygon(loop, tolMm)) > 0;
  const wantSuperset = role === "outer";
  return tessellateLoop(
    loop,
    (arc) => {
      const convex = loopIsCcw === arc.sweep > 0;
      return convex === wantSuperset ? "tangent" : "chord";
    },
    tolMm,
  );
}

/**
 * DXF bulge → arc. bulge = tan(θ/4), θ = signed included angle
 * (> 0 counter-clockwise from p to q). Returns null for a straight segment.
 * Centre = chord midpoint + leftNormal · (c/2)·(1 − b²)/(2b).
 */
function bulgeToArc(p: Point, q: Point, bulge: number): ArcEdge | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12) return null;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return null;
  const sweep = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const offset = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const cx = mx + (-dy / chord) * offset;
  const cy = my + (dx / chord) * offset;
  return { cx, cy, r: radius, a0: Math.atan2(p.y - cy, p.x - cx), sweep };
}

interface BulgeVertex extends Point {
  bulge: number;
}

function loopFromBulgeVertices(vs: BulgeVertex[]): RawLoop | null {
  const vertices: Point[] = vs.map((v) => ({ x: v.x, y: v.y }));
  const arcs = vs.map((v, i) => bulgeToArc(vertices[i], vertices[(i + 1) % vertices.length], v.bulge));
  const hasArc = arcs.some((a) => a !== null);
  // A 2-vertex closed polyline is only a real shape when both segments are
  // arcs (a lens / circle drawn as a "polyline circle").
  if (vertices.length < (hasArc ? 2 : 3)) return null;
  return { vertices, arcs };
}

function circleLoop(cx: number, cy: number, r: number): RawLoop {
  const pts: Point[] = [];
  for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
    const a = (2 * Math.PI * s) / CIRCLE_SEGMENTS;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { vertices: pts, arcs: pts.map(() => null) };
}

// Extracts every closed loop (already scaled to mm) from LWPOLYLINE,
// POLYLINE+VERTEX (both with bulge arcs) and CIRCLE entities inside the
// ENTITIES section. LINE and ARC entities are handled separately (they must
// be chained into loops — see reconstructLoopsFromSegments).
function extractClosedLoops(section: Tag[], mmPerUnit: number): RawLoop[] {
  const loops: RawLoop[] = [];
  if (section.length === 0) return loops;

  let i = 0;
  while (i < section.length) {
    const tag = section[i];
    if (tag.code === 0 && tag.value.toUpperCase() === "LWPOLYLINE") {
      let closed = false;
      const verts: BulgeVertex[] = [];
      let j = i + 1;
      while (j < section.length && !(section[j].code === 0)) {
        const t = section[j];
        if (t.code === 70) closed = (parseInt(t.value, 10) & 1) === 1;
        else if (t.code === 10) verts.push({ x: parseFloat(t.value) * mmPerUnit, y: 0, bulge: 0 });
        else if (t.code === 20 && verts.length > 0) verts[verts.length - 1].y = parseFloat(t.value) * mmPerUnit;
        else if (t.code === 42 && verts.length > 0) {
          const b = parseFloat(t.value);
          if (Number.isFinite(b)) verts[verts.length - 1].bulge = b;
        }
        j++;
      }
      if (closed) {
        const loop = loopFromBulgeVertices(verts);
        if (loop) loops.push(loop);
      }
      i = j;
      continue;
    }
    if (tag.code === 0 && tag.value.toUpperCase() === "POLYLINE") {
      let closed = false;
      const verts: BulgeVertex[] = [];
      let j = i + 1;
      while (j < section.length && !(section[j].code === 0 && section[j].value.toUpperCase() === "SEQEND")) {
        if (section[j].code === 70) closed = (parseInt(section[j].value, 10) & 1) === 1;
        if (section[j].code === 0 && section[j].value.toUpperCase() === "VERTEX") {
          let x: number | null = null, y: number | null = null;
          let bulge = 0;
          let k = j + 1;
          while (k < section.length && section[k].code !== 0) {
            if (section[k].code === 10) x = parseFloat(section[k].value) * mmPerUnit;
            if (section[k].code === 20) y = parseFloat(section[k].value) * mmPerUnit;
            if (section[k].code === 42) {
              const b = parseFloat(section[k].value);
              if (Number.isFinite(b)) bulge = b;
            }
            k++;
          }
          if (x !== null && y !== null) verts.push({ x, y, bulge });
          j = k;
          continue;
        }
        j++;
      }
      if (closed) {
        const loop = loopFromBulgeVertices(verts);
        if (loop) loops.push(loop);
      }
      i = j + 1;
      continue;
    }
    if (tag.code === 0 && tag.value.toUpperCase() === "CIRCLE") {
      let cx = 0, cy = 0, r = 0;
      let j = i + 1;
      while (j < section.length && section[j].code !== 0) {
        if (section[j].code === 10) cx = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 20) cy = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 40) r = parseFloat(section[j].value) * mmPerUnit;
        j++;
      }
      if (r > 0) loops.push(circleLoop(cx, cy, r));
      i = j;
      continue;
    }
    i++;
  }
  return loops;
}

interface Segment {
  start: Point;
  end: Point;
  /** Present for ARC entities; described start → end (see ArcEdge). */
  arc?: ArcEdge;
}

// Extracts every LINE entity inside the ENTITIES section as a raw segment
// (already scaled to mm). Zero-length lines are dropped here.
function extractLineSegments(section: Tag[], mmPerUnit: number): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < section.length) {
    const tag = section[i];
    if (tag.code === 0 && tag.value.toUpperCase() === "LINE") {
      let sx: number | null = null, sy: number | null = null;
      let ex: number | null = null, ey: number | null = null;
      let j = i + 1;
      while (j < section.length && section[j].code !== 0) {
        if (section[j].code === 10) sx = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 20) sy = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 11) ex = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 21) ey = parseFloat(section[j].value) * mmPerUnit;
        j++;
      }
      if (sx !== null && sy !== null && ex !== null && ey !== null) {
        const start = { x: sx, y: sy };
        const end = { x: ex, y: ey };
        const dist = Math.hypot(end.x - start.x, end.y - start.y);
        if (dist > LINE_CONNECTION_TOLERANCE_MM) {
          segments.push({ start, end });
        }
        // zero-length (or near-zero) lines are ignored per spec
      }
      i = j;
      continue;
    }
    i++;
  }
  return segments;
}

// Extracts every ARC entity. DXF ARCs are always counter-clockwise from the
// start angle to the end angle (degrees); an end angle <= the start angle
// wraps around (+360). Centre and radius are scaled to mm, angles are not.
function extractArcSegments(section: Tag[], mmPerUnit: number): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < section.length) {
    const tag = section[i];
    if (tag.code === 0 && tag.value.toUpperCase() === "ARC") {
      let cx = 0, cy = 0, r = 0;
      let startDeg: number | null = null, endDeg: number | null = null;
      let j = i + 1;
      while (j < section.length && section[j].code !== 0) {
        if (section[j].code === 10) cx = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 20) cy = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 40) r = parseFloat(section[j].value) * mmPerUnit;
        if (section[j].code === 50) startDeg = parseFloat(section[j].value);
        if (section[j].code === 51) endDeg = parseFloat(section[j].value);
        j++;
      }
      if (r > 0 && startDeg !== null && endDeg !== null && Number.isFinite(startDeg) && Number.isFinite(endDeg)) {
        const a0 = (startDeg * Math.PI) / 180;
        let sweep = ((endDeg - startDeg) * Math.PI) / 180;
        sweep = sweep % (2 * Math.PI);
        if (sweep <= 0) sweep += 2 * Math.PI;
        const arc: ArcEdge = { cx, cy, r, a0, sweep };
        const start = pointOnArc(arc, a0);
        const end = pointOnArc(arc, a0 + sweep);
        // Judge "degenerate" by ARC LENGTH, not chord length: a full circle
        // (or any near-full arc) has start ~ end but is a perfectly real
        // loop, whereas a line shorter than the connection tolerance is noise.
        if (r * sweep > LINE_CONNECTION_TOLERANCE_MM) segments.push({ start, end, arc });
      }
      i = j;
      continue;
    }
    i++;
  }
  return segments;
}

// Buckets a coordinate onto a grid sized to the connection tolerance, so
// that endpoints within tolerance of each other collapse onto the same
// "node". This is the "simple spatial hash / coordinate bucketing"
// approach called out as acceptable in the spec.
function nodeKey(p: Point): string {
  const gx = Math.round(p.x / LINE_CONNECTION_TOLERANCE_MM);
  const gy = Math.round(p.y / LINE_CONNECTION_TOLERANCE_MM);
  return `${gx},${gy}`;
}

interface LineReconstructionResult {
  loops: RawLoop[];
  hadAnySegments: boolean; // true if there were >=1 usable LINE/ARC segments at all
  hadOpenLeftover: boolean; // true if some segments did NOT form a closed loop
}

interface GraphEdge {
  a: number; // node at segment.start
  b: number; // node at segment.end
  arc?: ArcEdge; // described from node `a` towards node `b`
}

function reverseArc(arc: ArcEdge): ArcEdge {
  return { cx: arc.cx, cy: arc.cy, r: arc.r, a0: arc.a0 + arc.sweep, sweep: -arc.sweep };
}

// Reconstructs closed loops from a soup of (possibly out-of-order, possibly
// reversed) LINE and ARC segments. Segments that don't participate in a
// valid closed loop are simply left out of the result (e.g. unrelated open
// construction lines) — see spec's "MIXED GEOMETRY" / "IMPORTANT: OPEN
// LINES" sections.
//
// The graph is a MULTIgraph: an arc and a chord (or two arcs) may legally
// join the same two nodes (a lens / half-disc), and a full-circle ARC is a
// self-loop on a single node.
function reconstructLoopsFromSegments(segments: Segment[], arcToleranceMm: number): LineReconstructionResult {
  if (segments.length === 0) return { loops: [], hadAnySegments: false, hadOpenLeftover: false };

  // Assign each distinct (tolerance-collapsed) endpoint a node id, keeping
  // the first concrete coordinate seen for that node.
  const nodeIdByKey = new Map<string, number>();
  const nodeCoord: Point[] = [];
  function nodeIdFor(p: Point): number {
    const key = nodeKey(p);
    let id = nodeIdByKey.get(key);
    if (id === undefined) {
      id = nodeCoord.length;
      nodeIdByKey.set(key, id);
      nodeCoord.push(p);
    }
    return id;
  }

  // Dedupe edges so duplicate/overlapping entities don't create duplicate
  // polygon edges or inflate node degree. Lines dedupe by undirected node
  // pair; arcs additionally by their mid-point so two DIFFERENT arcs
  // between the same two nodes (e.g. two half circles) are both kept.
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const seg of segments) {
    const a = nodeIdFor(seg.start);
    const b = nodeIdFor(seg.end);
    let key: string;
    if (seg.arc) {
      const mid = pointOnArc(seg.arc, seg.arc.a0 + seg.arc.sweep / 2);
      key = `A:${Math.min(a, b)}-${Math.max(a, b)}:${nodeKey(mid)}`;
    } else {
      if (a === b) continue; // degenerate after bucketing
      key = `L:${Math.min(a, b)}-${Math.max(a, b)}`;
    }
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ a, b, arc: seg.arc });
  }

  // Incident edge ids per node. A self-loop is listed twice on its node, so
  // "degree === 2" is the uniform simple-cycle test.
  const incident = new Map<number, number[]>();
  edges.forEach((e, id) => {
    if (!incident.has(e.a)) incident.set(e.a, []);
    if (!incident.has(e.b)) incident.set(e.b, []);
    incident.get(e.a)!.push(id);
    incident.get(e.b)!.push(id);
  });

  // Connected components over nodes that have at least one edge.
  const visited = new Set<number>();
  const loops: RawLoop[] = [];
  let hadOpenLeftover = false;

  for (const startNode of incident.keys()) {
    if (visited.has(startNode)) continue;
    const component: number[] = [];
    const queue = [startNode];
    visited.add(startNode);
    while (queue.length > 0) {
      const n = queue.shift()!;
      component.push(n);
      for (const eid of incident.get(n) ?? []) {
        const e = edges[eid];
        for (const nb of [e.a, e.b]) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
    }

    const componentEdgeIds = new Set<number>();
    for (const n of component) for (const eid of incident.get(n) ?? []) componentEdgeIds.add(eid);
    const hasArc = [...componentEdgeIds].some((eid) => edges[eid].arc);

    const isSimpleCycle =
      // 1- and 2-node cycles are only real shapes when they contain an arc
      // (full-circle ARC, half-disc, lens); all-straight loops need >= 3.
      (component.length >= 3 || hasArc) &&
      componentEdgeIds.size === component.length &&
      component.every((n) => (incident.get(n)?.length ?? 0) === 2);

    if (!isSimpleCycle) {
      hadOpenLeftover = true;
      continue;
    }

    // Walk the cycle edge by edge starting from any node.
    const vertices: Point[] = [];
    const arcs: (ArcEdge | null)[] = [];
    let cur = component[0];
    let prevEdge = -1;
    for (let step = 0; step < componentEdgeIds.size; step++) {
      const options = incident.get(cur) ?? [];
      const eid = options.find((id) => id !== prevEdge) ?? options[0];
      const e = edges[eid];
      const next = e.a === cur ? e.b : e.a;
      vertices.push(nodeCoord[cur]);
      if (e.arc) arcs.push(e.a === cur ? e.arc : reverseArc(e.arc));
      else arcs.push(null);
      prevEdge = eid;
      cur = next;
    }

    const loop: RawLoop = { vertices, arcs };
    if (vertices.length >= 1 && Math.abs(signedArea(referencePolygon(loop, arcToleranceMm))) > 0) {
      loops.push(loop);
    } else {
      hadOpenLeftover = true;
    }
  }

  return { loops, hadAnySegments: true, hadOpenLeftover };
}

// ---------------------------------------------------------------------------
// Contour hierarchy
// ---------------------------------------------------------------------------

interface LoopInfo {
  raw: RawLoop;
  ref: Point[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function loopInfoFor(raw: RawLoop, tolMm: number): LoopInfo {
  const ref = referencePolygon(raw, tolMm);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ref) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { raw, ref, area: shoelaceArea(ref), minX, minY, maxX, maxY };
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distPointToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 1 = strictly inside, 0 = on the boundary (within BOUNDARY_EPS_MM), -1 = outside. */
function classifyPoint(p: Point, poly: Point[]): 1 | 0 | -1 {
  if (distPointToPolygon(p, poly) <= BOUNDARY_EPS_MM) return 0;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 1 : -1;
}

/** `inner` lies inside `outer` (loops of a valid drawing never cross, so a majority vote over the vertices is robust to a few boundary-touching ones). */
function loopContains(outer: LoopInfo, inner: LoopInfo): boolean {
  if (inner.minX < outer.minX - BOUNDARY_EPS_MM || inner.maxX > outer.maxX + BOUNDARY_EPS_MM) return false;
  if (inner.minY < outer.minY - BOUNDARY_EPS_MM || inner.maxY > outer.maxY + BOUNDARY_EPS_MM) return false;
  let inside = 0;
  let outside = 0;
  for (const p of inner.ref) {
    const c = classifyPoint(p, outer.ref);
    if (c === 1) inside++;
    else if (c === -1) outside++;
  }
  return inside > outside;
}

// The same contour drawn twice (extremely common in CAD: overlapping
// duplicate entities) must not become a second part or a zero-net-area
// "hole". Two loops are duplicates when they have (nearly) the same area and
// every vertex of each lies on the other's outline.
function isDuplicateLoop(a: LoopInfo, b: LoopInfo): boolean {
  if (Math.abs(a.area - b.area) > 1e-6 * Math.max(a.area, b.area) + 1e-9) return false;
  if (
    Math.abs(a.minX - b.minX) > LINE_CONNECTION_TOLERANCE_MM ||
    Math.abs(a.maxX - b.maxX) > LINE_CONNECTION_TOLERANCE_MM ||
    Math.abs(a.minY - b.minY) > LINE_CONNECTION_TOLERANCE_MM ||
    Math.abs(a.maxY - b.maxY) > LINE_CONNECTION_TOLERANCE_MM
  ) {
    return false;
  }
  return (
    a.ref.every((p) => distPointToPolygon(p, b.ref) <= LINE_CONNECTION_TOLERANCE_MM) &&
    b.ref.every((p) => distPointToPolygon(p, a.ref) <= LINE_CONNECTION_TOLERANCE_MM)
  );
}

interface ClassifiedPart {
  outer: LoopInfo;
  holes: LoopInfo[];
}

/**
 * Even-odd containment hierarchy (see the header comment). `depth` = how many
 * other loops contain a loop; even → independent outer contour, odd → hole of
 * its IMMEDIATE (smallest) container.
 */
function classifyLoops(rawLoops: RawLoop[], tolMm: number): ClassifiedPart[] {
  const sorted = rawLoops
    .map((raw) => loopInfoFor(raw, tolMm))
    .filter((info) => info.area > MIN_LOOP_AREA_MM2)
    .sort((a, b) => b.area - a.area);

  const infos: LoopInfo[] = [];
  for (const info of sorted) {
    if (!infos.some((kept) => isDuplicateLoop(kept, info))) infos.push(info);
  }

  const parentOf: number[] = new Array(infos.length).fill(-1);
  const depthOf: number[] = new Array(infos.length).fill(0);
  for (let i = 0; i < infos.length; i++) {
    let depth = 0;
    let parent = -1;
    // `infos` is sorted by area descending, so only earlier entries can
    // contain loop i; the LAST container found is the smallest → immediate.
    for (let j = 0; j < i; j++) {
      if (infos[j].area <= infos[i].area) continue;
      if (loopContains(infos[j], infos[i])) {
        depth++;
        parent = j;
      }
    }
    depthOf[i] = depth;
    parentOf[i] = parent;
  }

  const parts: ClassifiedPart[] = [];
  const partIndexByLoop = new Map<number, number>();
  infos.forEach((info, i) => {
    if (depthOf[i] % 2 === 0) {
      partIndexByLoop.set(i, parts.length);
      parts.push({ outer: info, holes: [] });
    }
  });
  infos.forEach((info, i) => {
    if (depthOf[i] % 2 === 1) {
      const partIdx = partIndexByLoop.get(parentOf[i]);
      if (partIdx !== undefined) parts[partIdx].holes.push(info);
    }
  });
  return parts;
}

function boundsOf(pts: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function buildPartGeometry(part: ClassifiedPart, tolMm: number): DxfPartGeometry {
  const outer = conservativePolygon(part.outer.raw, "outer", tolMm);
  const holes = part.holes.map((h) => conservativePolygon(h.raw, "hole", tolMm));
  const netAreaMm2 = shoelaceArea(outer) - holes.reduce((sum, h) => sum + shoelaceArea(h), 0);
  const b = boundsOf([...outer, ...holes.flat()]);
  return {
    outer,
    holes,
    areaSqm: netAreaMm2 / 1_000_000,
    bboxWidthMm: b.maxX - b.minX,
    bboxHeightMm: b.maxY - b.minY,
  };
}

export function parseDxf(text: string, options: ParseDxfOptions = {}): DxfGeometryResult {
  const arcToleranceMm = options.arcToleranceMm ?? DEFAULT_ARC_TOLERANCE_MM;
  if (!Number.isFinite(arcToleranceMm) || arcToleranceMm <= 0) {
    throw new RangeError(`arcToleranceMm must be a finite number > 0 (got ${String(options.arcToleranceMm)})`);
  }

  const invalid = (msg: string): DxfGeometryResult => ({
    valid: false,
    errorMessage: msg,
    unitsDetected: "unknown",
    areaSqm: null,
    bboxWidthMm: null,
    bboxHeightMm: null,
    outerContourCount: 0,
    holeCount: 0,
    unitsWarning: null,
    geometry: null,
    parts: [],
  });

  if (!text || text.trim().length === 0) return invalid("Empty file.");

  let tags: Tag[];
  try {
    tags = tokenize(text);
  } catch {
    return invalid("Could not parse DXF group codes — the file may be binary DXF (unsupported) or corrupted.");
  }
  if (tags.length === 0) return invalid("Not a recognizable DXF (no group codes found).");

  const units = detectUnits(tags);
  const section = getEntitiesSection(tags);

  // LWPOLYLINE / POLYLINE / CIRCLE loops are complete on their own. LINE and
  // ARC entities must be chained into loops. Per spec, mixed geometry should
  // all be considered together, so we always attempt the chained
  // reconstruction and fold any resulting loops in alongside the others.
  const rawLoops = extractClosedLoops(section, units.factor);
  const segments = [...extractLineSegments(section, units.factor), ...extractArcSegments(section, units.factor)];
  const lineResult = reconstructLoopsFromSegments(segments, arcToleranceMm);
  for (const loop of lineResult.loops) rawLoops.push(loop);

  if (rawLoops.length === 0) {
    if (lineResult.hadAnySegments && lineResult.hadOpenLeftover) {
      return invalid("Open contour detected — LINE/ARC segments do not form a closed loop.");
    }
    return invalid("Open contour detected — no closed supported geometry could be reconstructed.");
  }

  const classified = classifyLoops(rawLoops, arcToleranceMm);
  if (classified.length === 0) {
    return invalid("Open contour detected — no closed supported geometry could be reconstructed.");
  }

  // Deterministic part order: largest outer contour first, then by position.
  const parts = classified
    .map((c) => buildPartGeometry(c, arcToleranceMm))
    .sort((a, b) => {
      const areaDiff = b.areaSqm - a.areaSqm;
      if (Math.abs(areaDiff) > 1e-12) return areaDiff;
      const ab = boundsOf(a.outer);
      const bb = boundsOf(b.outer);
      return ab.minX - bb.minX || ab.minY - bb.minY;
    });

  const holeCount = parts.reduce((sum, p) => sum + p.holes.length, 0);

  if (parts.length > 1) {
    // The persisted model is one outer contour per takeoff part. Silently
    // keeping the largest part and turning the others into holes (or
    // dropping them) would produce a wrong shape and wrong area, so a
    // multi-part file is rejected with an actionable message; the full
    // per-part breakdown is still returned in `parts`.
    const sizes = parts
      .slice(0, 5)
      .map((p) => `${p.bboxWidthMm.toFixed(0)}×${p.bboxHeightMm.toFixed(0)} mm`)
      .join(", ");
    return {
      ...invalid(
        `This DXF contains ${parts.length} independent parts (${sizes}${parts.length > 5 ? ", …" : ""}). ` +
          `Each takeoff part needs its own single-part DXF — split the file, or remove the extra contours.`,
      ),
      unitsDetected: units.label,
      outerContourCount: parts.length,
      holeCount,
      parts,
    };
  }

  const only = parts[0];
  return {
    valid: true,
    errorMessage: null,
    unitsDetected: units.label,
    areaSqm: only.areaSqm,
    bboxWidthMm: only.bboxWidthMm,
    bboxHeightMm: only.bboxHeightMm,
    outerContourCount: 1,
    holeCount,
    unitsWarning: checkUnitsSanity(only.bboxWidthMm, only.bboxHeightMm, units.label, units.factor),
    geometry: { outer: only.outer, holes: only.holes },
    parts,
  };
}
