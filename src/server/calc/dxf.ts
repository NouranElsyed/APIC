// Minimal, dependency-free DXF (ASCII) parser scoped to what Phase 1 of
// DXF Nesting actually needs: closed 2D plate/sheet profiles.
//
// Deliberately NOT a full DXF implementation — it reads the ENTITIES
// section, pulls out LWPOLYLINE / POLYLINE+VERTEX / CIRCLE entities, and
// classifies each closed loop as either the outer contour (the one with
// the largest area) or an internal hole. Everything else (layers, blocks,
// dimensions, text, splines, etc.) is ignored for now — a DXF containing
// only unsupported entities is reported as invalid rather than silently
// guessed at.
//
// Critical rule (per spec): the outer/hole polygons below ARE the source
// of truth for area and future nesting. The bounding box is metadata
// only, never used to derive area or the nesting shape itself.

export interface Point {
  x: number;
  y: number;
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
  geometry: { outer: Point[]; holes: Point[][] } | null; // normalized to mm
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

// Extracts every closed polygon (already scaled to mm) from LWPOLYLINE,
// POLYLINE+VERTEX and CIRCLE entities inside the ENTITIES section.
function extractClosedPolygons(tags: Tag[], mmPerUnit: number): Point[][] {
  const polygons: Point[][] = [];
  const section = getEntitiesSection(tags);
  if (section.length === 0) return polygons;

  let i = 0;
  while (i < section.length) {
    const tag = section[i];
    if (tag.code === 0 && tag.value.toUpperCase() === "LWPOLYLINE") {
      let closed = false;
      const pts: Point[] = [];
      let j = i + 1;
      let cur: Partial<Point> = {};
      while (j < section.length && !(section[j].code === 0)) {
        const t = section[j];
        if (t.code === 70) closed = (parseInt(t.value, 10) & 1) === 1;
        if (t.code === 10) { if (cur.x !== undefined) { pts.push({ x: cur.x, y: cur.y ?? 0 }); cur = {}; } cur.x = parseFloat(t.value) * mmPerUnit; }
        if (t.code === 20) cur.y = parseFloat(t.value) * mmPerUnit;
        j++;
      }
      if (cur.x !== undefined) pts.push({ x: cur.x, y: cur.y ?? 0 });
      if (closed && pts.length >= 3) polygons.push(pts);
      i = j;
      continue;
    }
    if (tag.code === 0 && tag.value.toUpperCase() === "POLYLINE") {
      let closed = false;
      const pts: Point[] = [];
      let j = i + 1;
      while (j < section.length && !(section[j].code === 0 && section[j].value.toUpperCase() === "SEQEND")) {
        if (section[j].code === 70) closed = (parseInt(section[j].value, 10) & 1) === 1;
        if (section[j].code === 0 && section[j].value.toUpperCase() === "VERTEX") {
          let x: number | null = null, y: number | null = null;
          let k = j + 1;
          while (k < section.length && section[k].code !== 0) {
            if (section[k].code === 10) x = parseFloat(section[k].value) * mmPerUnit;
            if (section[k].code === 20) y = parseFloat(section[k].value) * mmPerUnit;
            k++;
          }
          if (x !== null && y !== null) pts.push({ x, y });
          j = k;
          continue;
        }
        j++;
      }
      if (closed && pts.length >= 3) polygons.push(pts);
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
      if (r > 0) {
        const segs = 64;
        const pts: Point[] = [];
        for (let s = 0; s < segs; s++) {
          const a = (2 * Math.PI * s) / segs;
          pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        polygons.push(pts);
      }
      i = j;
      continue;
    }
    i++;
  }
  return polygons;
}

interface Segment { start: Point; end: Point; }

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
  loops: Point[][];
  hadAnySegments: boolean; // true if there were >=1 usable LINE segments at all
  hadOpenLeftover: boolean; // true if some segments did NOT form a closed loop
}

// Reconstructs closed polygon loops from a soup of (possibly out-of-order,
// possibly reversed) LINE segments. Segments that don't participate in a
// valid closed loop are simply left out of the result (e.g. unrelated open
// construction lines) — see spec's "MIXED GEOMETRY" / "IMPORTANT: OPEN
// LINES" sections.
function reconstructLoopsFromLines(segments: Segment[]): LineReconstructionResult {
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

  // Dedupe edges (undirected) so duplicate/overlapping LINE entities don't
  // create duplicate polygon edges or inflate node degree.
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  for (const seg of segments) {
    const a = nodeIdFor(seg.start);
    const b = nodeIdFor(seg.end);
    if (a === b) continue; // degenerate after bucketing
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([a, b]);
  }

  // Adjacency list.
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  // Find connected components over the nodes that have at least one edge.
  const visited = new Set<number>();
  const loops: Point[][] = [];
  let hadOpenLeftover = false;

  for (const startNode of adj.keys()) {
    if (visited.has(startNode)) continue;
    // BFS to collect the component.
    const component: number[] = [];
    const queue = [startNode];
    visited.add(startNode);
    while (queue.length > 0) {
      const n = queue.shift()!;
      component.push(n);
      for (const nb of adj.get(n) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    const componentEdgeCount = component.reduce((sum, n) => sum + (adj.get(n)?.length ?? 0), 0) / 2;
    const isSimpleCycle =
      component.length >= 3 &&
      componentEdgeCount === component.length &&
      component.every((n) => (adj.get(n)?.length ?? 0) === 2);

    if (!isSimpleCycle) {
      hadOpenLeftover = true;
      continue;
    }

    // Walk the cycle in order starting from any node.
    const ordered: Point[] = [];
    const seen = new Set<number>();
    let prev = -1;
    let cur = component[0];
    while (!seen.has(cur)) {
      seen.add(cur);
      ordered.push(nodeCoord[cur]);
      const neighbors = adj.get(cur) ?? [];
      const next = neighbors.find((n) => n !== prev) ?? neighbors[0];
      prev = cur;
      cur = next;
    }

    if (ordered.length >= 3 && shoelaceArea(ordered) > 0) {
      loops.push(ordered);
    } else {
      hadOpenLeftover = true;
    }
  }

  return { loops, hadAnySegments: true, hadOpenLeftover };
}

export function parseDxf(text: string): DxfGeometryResult {
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
  const polygons = extractClosedPolygons(tags, units.factor);

  // LINE entities are only considered when LWPOLYLINE/POLYLINE/CIRCLE
  // didn't already produce closed geometry to reconstruct from — but per
  // spec, mixed geometry (LWPOLYLINE + LINE + CIRCLE) should all be
  // considered together, so we always attempt LINE reconstruction and
  // fold any resulting loops in alongside the other polygons.
  const section = getEntitiesSection(tags);
  const lineSegments = extractLineSegments(section, units.factor);
  const lineResult = reconstructLoopsFromLines(lineSegments);
  for (const loop of lineResult.loops) polygons.push(loop);

  if (polygons.length === 0) {
    if (lineResult.hadAnySegments && lineResult.hadOpenLeftover) {
      return invalid("Open contour detected — LINE segments do not form a closed loop.");
    }
    return invalid("Open contour detected — no closed supported geometry could be reconstructed.");
  }

  const withArea = polygons.map((pts) => ({ pts, area: shoelaceArea(pts) })).sort((a, b) => b.area - a.area);
  const outer = withArea[0].pts;
  const holes = withArea.slice(1).map((w) => w.pts);
  const netAreaMm2 = withArea[0].area - holes.reduce((sum, h) => sum + shoelaceArea(h), 0);

  const allPts = polygons.flat();
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const bboxWidthMm = Math.max(...xs) - Math.min(...xs);
  const bboxHeightMm = Math.max(...ys) - Math.min(...ys);

  return {
    valid: true,
    errorMessage: null,
    unitsDetected: units.label,
    areaSqm: netAreaMm2 / 1_000_000,
    bboxWidthMm,
    bboxHeightMm,
    outerContourCount: 1,
    holeCount: holes.length,
    unitsWarning: checkUnitsSanity(bboxWidthMm, bboxHeightMm, units.label, units.factor),
    geometry: { outer, holes },
  };
}
