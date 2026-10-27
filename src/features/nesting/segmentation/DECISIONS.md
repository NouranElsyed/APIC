# Part Segmentation — agreed decisions (Phase 0)

Status: Phases 1-8 implemented. Not verified: behaviour in a real browser, a real CAM import of the DXF files, and the nest on a real canvas (tests use the canvas stand-in of the existing engine tests).

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
- Overlap / gap: off by default, value field empty until typed; enabling it without a value (or with 0) blocks generation. The value is signed — see Phase 7 notes.
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

## Phase 6 behaviour (approve → pieces in the nest)
- Approve creates one ordinary nestable part per segment, right under the original, named `<original>-<segment id>` (e.g. `PART-001-S01`). Each piece has the SAME quantity as the original (each original needs one of each piece), and its thickness / material. Pieces are never multiplied again.
- The ORIGINAL stays in the parts list as "SEGMENTED · N parts". It keeps its own quantity, size, thickness and material, so the takeoff still sees one original (100 kg × 3 stays 300 kg). It is excluded from nesting (`leftOf` = 0, `runOptimize` skips it, merges never fold a new part into it).
- The plan (cuts + settings) is stored on the original in `Group.seg.plan`, so it travels with snapshots, saved nests and history without any change to `persist.ts`. "Edit segmentation" re-opens the saved cuts; "Undo segmentation" removes the pieces and restores a plain part.
- Editing the original's quantity / thickness / material updates its pieces; a piece's own quantity / thickness / material are read-only. The size of a segmented part cannot be changed (undo first). Segmented parts and pieces cannot be duplicated; deleting an original deletes its pieces; a piece cannot be deleted on its own.
- Standard Calculations: `parseNestParts` skips pieces (the original is the takeoff item); the 2D report lists the pieces, not the original.
- If pieces of an earlier version were already on sheets, replacing or undoing a segmentation clears the nesting result (same as deleting a part does).

## What the optimiser can really place (important)
The engine rasterises each part on a grid (`cell`) after growing it by half the spacing (`gp`). The largest part it can put on a margined sheet is therefore a little SMALLER than the usable area: per dimension `(G − ⌈gp/(2·cell)⌉)·cell − gp/2` with `G = ⌊(L − 2·mg + gp)/cell⌋` (e.g. 6000 × 1500, margin 5, spacing 5, cell 5 → 5987.5 × 1487.5, not 5990 × 1490). Verified against the engine's own placement for several cell / spacing combinations. Consequences:
- A part between that limit and the usable area cannot be placed ("no free position found"). It is reported as NEEDS SEGMENTATION with an explanation; lowering the grid cell or the spacing is the alternative.
- The planner sizes every segment to this limit (it needs the nest's `gp` and `cell`, which the dialog passes in). Solo (margin-free) segments may use the whole raw sheet.

## Overlap and gap are one signed value (decided after Phase 6)
- Positive = OVERLAP: the pieces are welded on top of each other; one side extends into its neighbour by that amount (clipped to the original outline).
- Negative = GAP: a gap of |value| is left between the pieces; the carrier side is cut back from the seam by that amount (policy "A": the lower-coordinate piece by the whole gap, "alternate": alternating seam by seam, "symmetric": both pieces by half). A gap that leaves nothing of a piece is an error.
- Either way the FINISHED geometry (takeoff area, reassembly, seam length) does not change; the CUT geometry (fit checks, material estimates, the pieces created on approval, engine checks) does. 0 is not a value.
- A gap can make a finished piece a little longer than the sheet, because only the cut piece has to fit. The generator does not exploit that; it sizes finished pieces to the limits.

## Phase 7 behaviour (ranking and engine checks)
- "Check with nesting engine" nests the top 6 layouts (valid ones, in the current order) with the real `runOptimize`, one after the other, using the nest's margin, spacing, grid cell, rotation, pair-triangles and common-cut options, quantity × pieces, on the layout's own sheet size. Budget: 2 s per layout. Stop abandons the run and discards the unfinished layout. "Check this layout" does the same for the layout as currently edited; its result is hidden as soon as the cuts or settings change.
- Sheets / utilization / scrap use the same formulas as the saved-nests table (`nestMetrics`; verified equal in the tests).
- Order: layouts checked with the engine (that nest completely) → layouts with area estimates (≥) → layouts the engine could not nest completely → invalid layouts. Inside a group the user-chosen priority comes first: fewest sheets (then seams, then segments), shortest seams, or fewest segments. Sheet counts from the engine and estimates are never compared with each other.
- "Why this order?" states the order, what #1 is, how it differs from #2, which layout is best on the other factors, and the limits. "Compare" shows up to 3 layouts side by side with the best value of each factor highlighted.
- Limits stated to the user: no prices (not a cost optimum); each layout is nested alone, not mixed with the rest of the nest; the engine is randomised and short, so close results can differ by a sheet.

## Phase 8: export
- `dxf-write.ts` - DXF R12 like the app's own exporter (POLYLINE/VERTEX with bulges, CIRCLE, LINE, TEXT; non-ASCII text as \U+XXXX). A piece file holds the CUT geometry at the origin (layer CUT only by default; the same coordinates, names and sizes as the part created in the nest). The assembly drawing has layers ORIGINAL, SEGMENTS (finished pieces), CUT_GEOMETRY (only when an overlap/gap makes it differ), SEAMS, LABELS.
- `zip.ts` - STORE zip, UTF-8 names, no new dependency. `report.ts` - Excel: Summary (original, quantity, pieces to nest, allowance, source sheets, reassembly check), Segments (DXF file, qty, cut and finished size, areas, fit, assembly X/Y and cut X/Y), Seams, Mating edges (what each piece mates with, along which line, and the overlap/gap applied to it). `bundle.ts` - one zip: a DXF per piece, the assembly drawing and the report. `export-action.ts` - the download, and "export a segmented original" from its saved plan (refuses with a reason when there is none, the part changed since, or the plan has errors).
- Entry points: the dialog's Export button (the layout on screen, as edited) and "Export segments (DXF + report)" in the menu of a segmented original.
- Verified: files re-import through the app's own `parseDXF` with the arcs intact and the exact area; the pieces placed at the reported positions tile the original with no gap or overlap (sampled); with an overlap they cover it and overlap only along seams; with a gap they never overlap; exported pieces equal the nest's parts (names, sizes, quantity). Independent check with ezdxf (a separate DXF implementation): all 43 piece files and the assembly drawings audit with no errors, every arc/circle has the expected radius (3760; cone 3354.102 / 1118.034) and the areas match ours to 6e-8 (coordinate rounding).
- Not verified: a real CAM import; whether a given cutting program reads layer CUT only (piece files contain nothing else unless annotations are enabled).

## Free-form cuts (hand-drawn cut lines)
- A third kind of cut next to strip cuts and seams, for parts where axis-aligned cuts do not give good pieces (rings, cones, odd outlines). Toolbar button **Free cut**: press on the drawing, drag across the part, release. The tool stays on for further lines (click it again or press Esc).
- Stored in the plan as `freeCuts: { id: "F1", pts: [x, y][] }[]` (optional; plans saved earlier have none and are unchanged). The drawn stroke is simplified (Ramer–Douglas–Peucker, ≤ 0.4 % of the part size) to a polyline; points can be dragged, added (double-click the line) and removed (double-click a dot); the whole line can be dragged or nudged with the arrow keys. Grid snap applies.
- Kernel: `free-cut.ts`. The line is clipped to the material; arcs stay exact (the boundary is only subdivided at the crossings); holes crossed become notches; concave shapes give several pieces. Faces are traced from the chords, so lines that cross themselves are NOT allowed (reported as `BAD_CUT`, that cut is skipped, the rest of the plan still draws).
- A line whose end is drawn inside the part is **extended straight along its last segment** to the edge, so every free cut separates the part. The seam drawn in orange is what is actually cut.
- Order: strips → seams → free cuts. Every free cut is applied to every cell, one after the other, so lines that cross each other work. Pieces are numbered one by one (`S01`, `S02`, …), lowest then leftmost first, and keep `cell` = their strip/seam cell.
- Degenerate lines (through a vertex, along an edge, tangent to an arc) are moved by +0.0001 mm (same policy as the other cuts, up to 5 tries, one shift for all pieces so neighbours mate), reported as `CUT_SHIFTED`.
- Hole policy, max seam length, min segment size and the area-based sheet bound apply as for other cuts. Seam stagger / cross-junction / seam-to-boundary checks do not (they are defined for parallel strips).
- **Not supported yet:** overlap / gap together with free cuts. Enabling it is an error (`FREE_CUT_OVERLAP`), never silently ignored; finished and cut geometry are equal while free cuts exist. The automatic layout generator does not propose free cuts; they are added by hand (switching H ↔ V keeps them).
- Seams of free cuts are the straight boundary two pieces of one cell share along the drawn line (`PlanSeam.kind = "free"`, `path` = segments). Report: "Free-form cuts" row, seam kind "free-form cut", mating-edge line "free line (x, y) → (x, y)". DXF assembly drawing: the seam segments on layer SEAMS, labelled with the cut id.
- Verified: kernel tests (areas add up, arcs kept, ring through hole, U-shape, crossing cuts, degenerate lines), plan/editor/commit/report/DXF/render tests, and 400 random hand-drawn lines on a C-shaped ring without an exception or a lost mm². Not verified: pointer drawing in a real browser (the pure logic and the rendered markup are tested, the mouse handling is not), and a real CAM import of the free-cut DXF files.

## Radial cut (N sectors around a centre point)
- Toolbar button **Radial**: click the drawing to set the centre (or type X / Y), then set **Divisions** (2–72) and **Start angle** (direction of the first cut line, degrees counter-clockwise from +x). The centre dot can be dragged; arrow keys nudge it. Stored as `radial: { center, count, startDeg }` in the plan (optional, absent in older plans).
- Cut lines are rays from the centre; sector `i` lies between ray `i` and ray `i+1`. The centre may be inside material (solid part: pie slices meeting at the centre), inside a hole (ring: the cuts run from the hole to the outer edge) or outside the part. Arcs stay exact.
- Method (`splitRegionsRadial`): every sector is cut out of the cell piece on its own with a V-shaped line (far point → centre → far point) and the faces inside the wedge are kept, so neighbouring sectors share exactly the same ray. Pieces are numbered sector by sector (S01 = first sector).
- Degenerate pattern (a ray through a vertex, along an edge …): the WHOLE pattern is moved by 0.0001 mm steps (the centre), never single rays, so seams still mate; reported as `CUT_SHIFTED`.
- Hole policy: a ray counts as cutting through a hole only if it ENTERS a hole that does not contain the centre. Rays leaving the hole the centre sits in are not hole cuts.
- Applied to every cell, before free cuts; combines with strip cuts, seams and free cuts. Overlap / gap is not supported with it (`FREE_CUT_OVERLAP`). Seams are reported per ray (`R1`…`Rn`, kind "free"). Not proposed by the automatic layout generator.
