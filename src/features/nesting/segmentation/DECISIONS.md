# Part Segmentation — agreed decisions (Phase 0)

Status: Phases 1–5 implemented (geometry kernel, fit detection + badge + "Segment Part" button, planner, settings dialog, interactive editing with live validation). Creating the segments as parts (Approve), engine-based ranking and export are NOT started.

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

## Phase 4 behaviour (dialog, read-only)
- "Segment Part" appears next to the NEEDS SEGMENTATION badge. The dialog only reads the part; closing it discards everything; Approve is disabled until the commit phase.
- Arcs: rebuilt from the importer's own tessellation signature (vertices exactly on one circle at equal steps ≤ 5°, tolerance 0.001 mm). No importer change, old parts untouched. If nothing matches, the polygon outline is used and the dialog says so. Limitation: a polygon drawn with LINEs on a circle at equal ≤ 5° steps is indistinguishable from a tessellated circle. Rounding-level coordinate noise (≈1e-6) is tolerated; 0.5 mm noise is not rebuilt.
- Source sheets: each source has its own length and width fields (no dropdown); quantity unlimited. The nest itself still uses its single sheet size.
- Overlap: off by default, value field empty until typed; enabling it without a value blocks generation.
- Hole policy "warn": the preview lists each unconfirmed cut with a confirmation checkbox and re-validates the selected layout immediately.
- Layouts are generated on the main thread (≈0.3 s for the Ø7520 circle). Very detailed outlines may take longer; a worker is a possible later improvement.

## Phase 5 behaviour (editing)
- Editing works on a draft copy of the selected layout's cut lists; the plan (segments, seams, issues, metrics) is re-derived with `buildPlan` on every change, so the preview cannot drift from the geometry. ≈3 ms per step for the Ø7520 circle, ≈13 ms with overlap.
- Tools: drag a cut line, select + arrow keys (Shift ×10), exact position field, add strip cut / add seam (click in the drawing), remove (button or Delete), Undo/Redo (buttons, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), Reset to the generated proposal (undoable), optional grid snap (grid size is typed by the user, off by default), switch H ↔ V (builds the best layout in the other direction; one undo step).
- A whole drag is ONE undo step. History is capped at 100 steps.
- Seams belong to a STRIP, identified by the strip cut directly below it, so moving cuts never moves a seam into another strip. Adding a strip cut inside a strip with seams gives the same seams to both halves (so the layout stays valid); removing a strip cut merges the strips and drops seams that would land within 1 mm of another.
- Prevented (clamped or refused, with a message): a cut past a neighbouring cut or outside the part, or on top of another cut. The minimum distance (1 mm) is a UI rule, not a manufacturing rule.
- Allowed but reported: anything that makes the layout invalid (segment too large, hole crossed, constraint broken). The user can pass through such states while dragging and is told why.
- Settings (overlap, sheets, hole policy, constraints) apply live to the edited cuts. Generating new layouts asks before discarding edits.
