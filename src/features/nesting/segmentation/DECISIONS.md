# Part Segmentation — agreed decisions (Phase 0)

Status: Phase 1 (geometry kernel), Phase 2 (fit detection + status badge) and Phase 3 (planner: cut plans, overlap, validation, candidate generation) implemented. Phase 4 (dialog: settings + read-only preview, arcs rebuilt from imported polygons via `group-region.ts`, opened from the “Segment…” chip on NEEDS SEGMENTATION parts in Nest Boost) implemented. Approve/creating child parts, editing, nesting integration and export are NOT started.

## Geometry
- Contours are kept as **edges (line / arc)**, not polygons. Arcs and circles survive cutting exactly.
- Polygons are produced only for the nesting engine (`regionToPolygon`, tolerance default proposal: 0.1 mm, same as `DEFAULT_ARC_TOLERANCE_MM` in `server/calc/dxf.ts`).
- Original arc data is stored (optional field on `Group`) for **new imports only**. Existing parts and snapshots are not changed; for them segmentation falls back to the polygon with a visible warning.
- Cuts in phase 1 are axis-aligned straight lines (horizontal or vertical strips, plus transverse seams inside a strip).
- Degenerate cut line (through a vertex, along an edge, tangent to an arc): moved by +0.0001 mm per try (max 5), reported as `shifted`. Both neighbours use the same line.

## Sheets and margins
- Source sheets are entered per source as length × width (no dropdown, no presets). Quantity unlimited.
- A segment is valid if it fits the usable area (sheet minus margin) **or** the raw sheet alone (zero margin, "solo sheet"), as the engine already does in `soloRot`.
- Phase 1 of the feature keeps nesting on the single sheet size in `cfg` (W/H). If a segmentation sheet differs, Approve asks whether to apply it to the nest; otherwise non-fitting segments are flagged. True multi-size nesting is a later phase.

## Overlap
- Optional, **off by default**, value field empty until the user types one (the 50 mm in the mockup is an example only).
- When on: at each seam the lower-numbered segment extends by `o` into its neighbour, clipped to the original outline. The side policy is stored in the plan so it can change later.
- Not kerf, not root gap, not trim. Nothing else is added silently.

## Holes
- Setting "cut through holes": **Reject** (default) or **Warn and require confirmation**. Auto-generated candidates avoid holes when Reject is on. The kernel already reports `holesCrossed` per cut.

## Parent / children
- The original part stays as a row with status **Segmented**; child rows (`PART-001-S01`, …) sit under it.
- Parent is excluded from nesting; each child has quantity Q (the parent's quantity). Standard Calculations is never written to, so takeoff weight/area stays on the parent.
- Disconnected pieces of one strip get a letter suffix (`S02a`, `S02b`).

## Out of scope for this phase
Welding procedures, weld/cost calculations, inventory, rolling/grain direction.

## Phase 3 behaviour (planner.ts)
- `buildPlan` is the exact constructor (explicit strip cuts + transverse seam cuts); the Phase 5 editor will edit those lists. `generateCandidates` proposes them.
- Direction "H" = horizontal strips (cut lines y = const); "V" = vertical strips (x = const). Segments are numbered strip by strip (lowest coordinate first), then along the strip: `S01`, `S02`; disconnected pieces of one cell: `S02a`, `S02b`.
- Overlap carrier policy: "A" = lower-coordinate side extends into the higher; "alternate" = alternates by cut index; "symmetric" = each side extends mm/2. The extension is original material inside the cell's extended box, so it never leaves the outline; at a corner where two extensions meet the corner square is included. Finished geometry, takeoff area and seam length ignore overlap; fit checks and material estimates use the cut geometry.
- A cut that would leave the finished geometry unable to fit because of overlap is reported (`SEGMENT_TOO_LARGE`), never silently accepted.
- Hole policy: "reject" (default) makes a cut through a hole an error; "warn" makes it an error until the user confirms that cut id (`confirmedHoleCuts`), then a warning. The generator avoids holes in both modes when it can.
- Seam constraints (min stagger, min seam-to-boundary, max seam length, forbid cross junctions, min segment size) are all optional and unset by default — no value is assumed.
- Candidate order is a transparent default (valid first, area-based sheet lower bound, segment count, seam length), not a cost optimum. Real sheet counts need the nesting engine (later phase).
