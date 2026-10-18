/**
 * Segmentation kernel — shared types.
 *
 * Geometry is stored as closed loops of edges (straight lines and circular arcs)
 * so that arcs and circles survive clipping exactly. Tessellation to polygons is a
 * separate, explicit step (`flattenLoop` / `regionToPolygon`) used only where the
 * nesting engine needs polygons.
 *
 * All geometry objects are treated as IMMUTABLE: functions return new objects and
 * may share `Edge` instances between input and output.
 */

export type Pt = [number, number];

/** Circular-arc data. `sweep` is signed (radians): >0 counter-clockwise, <0 clockwise. */
export interface ArcData {
  c: Pt;
  r: number;
  /** Angle (radians) of the start point as seen from the centre. */
  a0: number;
  sweep: number;
}

/**
 * One boundary edge, travelled from `a` to `b`. Straight unless `arc` is set.
 * A full circle is a single edge with `a === b` and |sweep| = 2π, or two half arcs.
 */
export interface Edge {
  a: Pt;
  b: Pt;
  arc?: ArcData;
}

/** Closed loop: `loop[i].b` coincides with `loop[i + 1].a`, last `b` with first `a`. */
export type Loop = Edge[];

/**
 * A planar region: one outer loop plus holes.
 * Normalised orientation: outer counter-clockwise (area > 0), holes clockwise (area < 0).
 */
export interface Region {
  outer: Loop;
  holes: Loop[];
}

/** "x": the cut line is x = pos (vertical). "y": the cut line is y = pos (horizontal). */
export type Axis = "x" | "y";

export interface SplitOptions {
  /** Distance (same units as geometry, mm) below which a vertex/tangent counts as "on the line". */
  eps?: number;
}

export interface Seam {
  a: Pt;
  b: Pt;
}

export interface SplitResult {
  /** Pieces on the low side of the line (coordinate < usedPos), sorted. */
  low: Region[];
  /** Pieces on the high side of the line (coordinate > usedPos), sorted. */
  high: Region[];
  requestedPos: number;
  /** Position actually cut. Differs from `requestedPos` only when `shifted` (see policy below). */
  usedPos: number;
  /**
   * POLICY — degenerate cut lines. If the requested line passes through a vertex,
   * runs along an edge, or is tangent to an arc, the cut is moved by a tiny, fixed
   * step (+0.0001 mm per try, max 5 tries) in the +axis direction. Both neighbours
   * are cut on the same shifted line, so they still mate exactly. `shifted` tells
   * the caller this happened.
   */
  shifted: boolean;
  /** Material intervals of the cut line: the seams between `low` and `high`. */
  seams: Seam[];
  seamLength: number;
  /** Indices (into the input region's `holes`) of holes the line crosses. */
  holesCrossed: number[];
  /** |area(low) + area(high) − area(input)|. Should be ~0; callers can enforce a limit. */
  areaError: number;
}

export interface CutRecord {
  requestedPos: number;
  usedPos: number;
  shifted: boolean;
  seams: Seam[];
  seamLength: number;
  /** Per cut piece, indices into that piece's own `holes` (one entry per crossing). */
  holesCrossed: number[];
}

export interface SliceResult {
  /** strips[i] = pieces between cut i-1 and cut i (strips[0] below the first cut). */
  strips: Region[][];
  cuts: CutRecord[];
  /** Largest per-cut area error. */
  areaError: number;
}
