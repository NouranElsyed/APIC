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

// Extracts every closed polygon (already scaled to mm) from LWPOLYLINE,
// POLYLINE+VERTEX and CIRCLE entities inside the ENTITIES section.
function extractClosedPolygons(tags: Tag[], mmPerUnit: number): Point[][] {
  const polygons: Point[][] = [];

  // Isolate the ENTITIES section so HEADER/TABLES/BLOCKS content (which
  // can also contain 0/SECTION-style group codes) never leaks in.
  let start = -1, end = tags.length;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 2 && tags[i].value.toUpperCase() === "ENTITIES") { start = i; continue; }
    if (start >= 0 && tags[i].code === 0 && tags[i].value.toUpperCase() === "ENDSEC") { end = i; break; }
  }
  if (start < 0) return polygons;
  const section = tags.slice(start, end);

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

  if (polygons.length === 0) {
    return invalid("Open contour detected — no closed LWPOLYLINE/POLYLINE/CIRCLE geometry found. Every profile edge must form a closed loop.");
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
    geometry: { outer, holes },
  };
}
