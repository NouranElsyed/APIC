// Content of the Docs page: every feature of the four Nesting & Costing tabs.
// Text is plain data so it is easy to edit; `code` and **bold** are rendered by DocsView.

export type TabId = "standard" | "nesting" | "scrap" | "pricing";

export type Block =
  | { t: "p"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "keys"; rows: [string, string][] }
  | { t: "tip" | "note" | "warn"; text: string };

export interface DocSection {
  id: string;
  tab: TabId;
  title: string;
  summary: string;
  blocks: Block[];
}

export const TABS: { id: TabId; label: string; blurb: string }[] = [
  { id: "standard", label: "Standard Calculations", blurb: "Drawings, parts, areas and weights" },
  { id: "nesting", label: "DXF Nesting", blurb: "2D sheet nesting and 1D bar cutting" },
  { id: "scrap", label: "Scrap & Material", blurb: "Purchased material, scrap and its value" },
  { id: "pricing", label: "Steel Pricing", blurb: "BOQ pricing from rates and profiles" },
];

export const SECTIONS: DocSection[] = [
  // ------------------------------------------------------------------ STANDARD
  {
    id: "sc-overview",
    tab: "standard",
    title: "Overview & workflow",
    summary: "What the Nesting & Costing area is and how the four tabs fit together.",
    blocks: [
      {
        t: "p",
        text: "**Nesting & Costing** has four tabs. They share one **Project** selector at the top: pick the project once and every tab works on it.",
      },
      {
        t: "table",
        head: ["Tab", "What it does"],
        rows: [
          ["Standard Calculations", "Take-off: drawings and their parts (plates, hot-rolled sections, cones, pipes) with area, weight and paint area."],
          ["DXF Nesting", "Lays plates out on sheets (2D) and cuts bars, pipes and profiles from stock lengths (1D). Exports DXF and Excel reports."],
          ["Scrap & Material", "Turns the nesting result into purchased weight, scrap, reusable material and their cost/value."],
          ["Steel Pricing", "Prices a bill of quantities from an editable rate card, with a full cost build-up for each item."],
        ],
      },
      {
        t: "steps",
        items: [
          "Choose the project, then add a drawing in **Standard Calculations**.",
          "Add its parts: one by one, by importing DXF files (plates) or by importing a CSV (hot-rolled sections and pipes).",
          "Send the parts to **DXF Nesting**, optimise or nest by hand, and create the Excel report.",
          "Open **Scrap & Material** to price the purchased material and scrap.",
          "Use **Steel Pricing** for the priced BOQ of the job.",
        ],
      },
    ],
  },
  {
    id: "sc-drawings",
    tab: "standard",
    title: "Drawings",
    summary: "A drawing groups the parts of one fabrication drawing.",
    blocks: [
      { t: "p", text: "Press **Add Drawing** (top right) and fill in:" },
      {
        t: "table",
        head: ["Field", "Meaning"],
        rows: [
          ["Drawing Number", "Required, e.g. 13334036."],
          ["Title", "Required, e.g. Existing Riser Ø4657."],
          ["Weight from Drawing (kg)", "Optional. The weight printed on the drawing. If you enter it, the drawing header shows the difference **vs. Drawing** (red = your take-off is heavier, green = lighter)."],
        ],
      },
      {
        t: "p",
        text: "Each drawing header shows its **Total Area**, **Paint Area**, **Total Weight**, **Scrap** (only when scrap data exists) and the variance against the drawing weight. The bin icon deletes the drawing **and all its parts** (after a confirmation).",
      },
    ],
  },
  {
    id: "sc-items",
    tab: "standard",
    title: "Adding items & part types",
    summary: "Add Item, the four part types and what each one asks for.",
    blocks: [
      { t: "p", text: "Press **Add Item** at the bottom of a drawing. The **Part Type** decides which fields you see. The pencil icon on a row edits an item, the bin deletes it." },
      {
        t: "table",
        head: ["Part type", "Fields", "How it is measured"],
        rows: [
          ["Plate", "Thickness (mm), Width (m), Length (m), optional Cut-off area formula", "Area × thickness × 7.85"],
          ["Cone", "Thickness (mm), Height (m), D1 (m), D2 (m)", "Lateral surface of a frustum × thickness × 7.85"],
          ["Pipe", "Thickness (mm), OD (m), Length (m)", "Surface area (π × OD × length) × thickness × 7.85"],
          ["Hot Rolled", "Profile (e.g. IPE 120), Length (m), Weight per metre (kg/m), optional Paint area per metre (m²/m)", "kg/m × length × qty"],
        ],
      },
      {
        t: "p",
        text: "Every item also has **Item No.**, **Description**, **Material**, **Qty**, **Side** (External / Internal) and **Paint** (1 side or 2 sides). Side is only a label used to total external and internal weight separately.",
      },
      { t: "tip", text: "Dimensions of plates, cones and pipes are in **metres**; thickness is in **millimetres**." },
    ],
  },
  {
    id: "sc-formula",
    tab: "standard",
    title: "Area formulas (Excel style)",
    summary: "Plate, cone and pipe areas come from an editable formula.",
    blocks: [
      {
        t: "p",
        text: "For plates, cones and pipes the item form shows **Area formula (per piece, single face)**. It is pre-filled with a default and evaluated for one piece. Press the pencil next to it to unlock and edit; if the formula is invalid a red message appears and the area is 0.",
      },
      {
        t: "table",
        head: ["Type", "Default formula"],
        rows: [
          ["Plate", "`width*length` (with a cut-off: `width*length-(cut-off)`)"],
          ["Cone", "`PI()*((d1+d2)/2)*sqrt(height^2+((d1-d2)/2)^2)`"],
          ["Pipe", "`PI()*od*length`"],
        ],
      },
      { t: "p", text: "**Allowed:** numbers, `+ - * / ^`, brackets, `PI()`, `sqrt(x)`, `abs(x)` and the variables below (not case sensitive)." },
      {
        t: "table",
        head: ["Type", "Variables"],
        rows: [
          ["Plate", "`width`, `length`, `thk`, `qty`"],
          ["Cone", "`d1`, `d2`, `height`, `thk`, `qty`"],
          ["Pipe", "`od`, `length`, `thk`, `qty`"],
        ],
      },
      {
        t: "tip",
        text: "For a plate with a hole, type the hole area in **Cut-off area**, e.g. `PI()*0.15^2`. It is subtracted from the plate area automatically.",
      },
    ],
  },
  {
    id: "sc-math",
    tab: "standard",
    title: "How the numbers are calculated",
    summary: "Area, weight and paint area, and the Σ button that shows the equation.",
    blocks: [
      {
        t: "table",
        head: ["Result", "Plate / Cone / Pipe", "Hot Rolled"],
        rows: [
          ["Unit area", "Area formula, one piece, one face", "—"],
          ["Total area", "Unit area × qty", "—"],
          ["Weight (kg)", "Total area × thickness (mm) × 7.85", "kg/m × length × qty"],
          ["Paint area", "Total area × paint sides (1 or 2)", "Paint area per metre × length × qty"],
        ],
      },
      {
        t: "p",
        text: "The **Σ** button on any row expands the exact equation with your numbers substituted, so you can check a result instead of trusting it. Click it again (or ×) to close.",
      },
    ],
  },
  {
    id: "sc-dxf",
    tab: "standard",
    title: "Import DXF files (plates)",
    summary: "Create many plate items from DXF drawings in one go.",
    blocks: [
      { t: "p", text: "Press **Import DXF** on a drawing and choose one or more `.dxf` files (or drop them). Size, area and cut-outs are read from the drawing." },
      {
        t: "list",
        items: [
          "A DXF sheet that contains **several parts** is split into one row per part.",
          "Text written in the DXF is used: **“5mm”** over a group sets its thickness, **“x6”** next to a part sets its quantity.",
          "**Side (all)**, **Paint (all)**, **Material (all)** and **Default thickness mm** apply to every row at once; the default thickness is used only where the drawing has none.",
          "Each row can still be edited in the table, or removed with the × before importing.",
          "Files that cannot be read show an error you can dismiss; a units warning (amber triangle) means the drawing size looked suspicious — check its units.",
        ],
      },
      { t: "note", text: "Only `.dxf` files are accepted. Imported parts are plates." },
    ],
  },
  {
    id: "sc-csv",
    tab: "standard",
    title: "Import hot-rolled sections & pipes (CSV)",
    summary: "Bring in bars, angles, beams and pipes from a spreadsheet.",
    blocks: [
      { t: "p", text: "Press **Import CSV** on a drawing. The file needs at least a **length** and a **qty** column; unknown columns are ignored. Plates come from DXF files, not CSV." },
      {
        t: "table",
        head: ["Column", "Example", "Notes"],
        rows: [
          ["description", "Column leg", "Also read from name / part / item"],
          ["type", "hot rolled / pipe", ""],
          ["profile", "IPE120", "Hot rolled"],
          ["length_mm", "2450", "Use `length_m` if the column is in metres"],
          ["qty", "4", ""],
          ["kg_per_m", "10.4", "Hot rolled: weight per metre"],
          ["material", "S235", ""],
          ["side", "external", "external / internal"],
          ["paint_sides", "2", "1 or 2"],
          ["od_mm, thickness_mm", "114.3, 6", "Pipes"],
        ],
      },
      {
        t: "list",
        items: [
          "Separator can be comma, semicolon or tab; decimal comma and a UTF-8 BOM are accepted.",
          "A preview table lets you edit every value before anything is saved.",
        ],
      },
    ],
  },
  {
    id: "sc-rowdxf",
    tab: "standard",
    title: "DXF file on a single item",
    summary: "Attach a cutting drawing to one row (needed to nest a plate).",
    blocks: [
      { t: "p", text: "The **DXF** column of each row shows the state of its drawing:" },
      {
        t: "table",
        head: ["Icon", "Meaning"],
        rows: [
          ["Upload arrow", "No file yet — click to upload a `.dxf`."],
          ["Green file ✓", "Valid file. Hover to see area, size and hole count. Click it to **remove** the file."],
          ["Red file ✗", "The file is invalid (hover for the reason). Click to upload a new one."],
          ["Download arrow", "Download the stored file."],
          ["Layers icon", "Send this part to DXF Nesting."],
          ["Amber triangle", "Units warning — check that the drawing units are right."],
        ],
      },
    ],
  },
  {
    id: "sc-select",
    tab: "standard",
    title: "Selecting, deleting & sending to Nesting",
    summary: "Work on many items at once.",
    blocks: [
      {
        t: "list",
        items: [
          "Tick the checkbox of items (or the header checkbox for all). A bar appears with **Send selected to Nesting**, **Delete selected** and **Clear**.",
          "**Send all to Nesting (n)** at the bottom of a drawing sends every nestable part of that drawing.",
          "Routing is automatic: **plates with a valid DXF go to 2D**, every other type goes to **1D**. Items without a usable DXF (plates) or with qty 0 are skipped.",
          "You are taken to the **DXF Nesting** tab and the parts are queued there.",
        ],
      },
    ],
  },
  {
    id: "sc-filter",
    tab: "standard",
    title: "Filters & totals",
    summary: "Search across all drawings of the project.",
    blocks: [
      { t: "p", text: "Once a project has drawings, a filter panel appears. Filters apply to **all drawings** together and the totals below always match what is on screen." },
      {
        t: "table",
        head: ["Filter", "Behaviour"],
        rows: [
          ["Type", "All types, Plate, Hot Rolled, Cone, Pipe"],
          ["Thk (mm)", "Exact thickness match; empty = any"],
          ["Description", "Case-insensitive text search"],
          ["Side", "Both sides, External, Internal"],
        ],
      },
      { t: "p", text: "Totals shown: **Total Weight**, **Total Area**, **Total External** and **Total Internal** (kg). **Clear** resets the filters." },
    ],
  },
  {
    id: "sc-perm",
    tab: "standard",
    title: "Who can do what",
    summary: "Permissions by role.",
    blocks: [
      {
        t: "table",
        head: ["Action", "Admin", "Manager", "Engineer", "Viewer"],
        rows: [
          ["View calculations", "✓", "✓", "✓", "✓"],
          ["Add / edit / import", "✓", "✓", "✓", "—"],
          ["Delete items and drawings", "✓", "✓", "—", "—"],
        ],
      },
      { t: "p", text: "Buttons you are not allowed to use are hidden." },
    ],
  },

  // ------------------------------------------------------------------- NESTING
  {
    id: "nest-overview",
    tab: "nesting",
    title: "Overview",
    summary: "Two tools on one page: 2D sheet nesting and 1D bar cutting.",
    blocks: [
      {
        t: "p",
        text: "The **DXF Nesting** tab has a **2D** tool (plates laid out on sheets) and, below it, a **1D** tool (bars, pipes and profiles cut from stock lengths), followed by a **combined report** button.",
      },
      {
        t: "warn",
        text: "Both tools run in your browser. Parts, results and **saved nests are kept in the page only** — reloading or leaving the page clears them. Export the DXF or the Excel report before you leave.",
      },
      {
        t: "p",
        text: "You can use either tool with **manual uploads**, or feed it from **Standard Calculations** (Send to Nesting, or the “Import from Standard Calculations” button).",
      },
    ],
  },
  {
    id: "n2-import",
    tab: "nesting",
    title: "2D · 1. Import",
    summary: "Get plates into the tool.",
    blocks: [
      {
        t: "list",
        items: [
          "**Drop DXF files here or click** — one or many files. Each closed outline becomes a part; inner outlines become holes.",
          "**Import plates from Standard Calculations** — imports every plate of the selected project that has a valid DXF, with its quantity and thickness.",
          "**Drawing units (manual uploads only)** — set the units of the files you upload (mm by default). Plates from Standard Calculations already know their units.",
          "Parts sent from Standard Calculations with **Send to Nesting** are queued here automatically.",
        ],
      },
    ],
  },
  {
    id: "n2-settings",
    tab: "nesting",
    title: "2D · 2. Sheet & settings",
    summary: "Sheet size, margins, rotation and the optimiser.",
    blocks: [
      {
        t: "table",
        head: ["Setting", "Meaning"],
        rows: [
          ["Sheet length / width (mm)", "Stock sheet size (default 6000 × 1500)."],
          ["Edge margin (mm)", "Unused border around each sheet. Parts never enter it."],
          ["Part spacing (mm)", "Minimum gap between parts."],
          ["Rotation", "None · 0°/180° · 90° steps · 45° steps · 15° steps (slower). Angles the optimiser may try."],
          ["Optimize time (s)", "How long the optimiser searches. Longer usually means a tighter nest."],
          ["Auto-pair triangles", "Puts two triangles together as one pair to save material."],
          ["Common cut line", "Pairs share one cut line (no gap inside a pair)."],
        ],
      },
      {
        t: "list",
        items: [
          "**Optimize nest** starts the search; the status line shows the iteration and number of sheets. **Stop** ends it early and keeps the best result found.",
          "**Export DXF** writes the nested sheets as a DXF file.",
          "If you already nested by hand, Optimize asks before **replacing your manual nesting**.",
        ],
      },
      { t: "note", text: "Parts only share a sheet when both **thickness and material** match, so each material/thickness gets its own sheets." },
    ],
  },
  {
    id: "n2-parts",
    tab: "nesting",
    title: "2D · Parts & quantities",
    summary: "The list of imported parts.",
    blocks: [
      {
        t: "p",
        text: "Each row shows the part picture, file, size, area, holes, thickness, material, **Qty**, **Placed** and **Left / place by hand**. Change the quantity to nest more or fewer pieces.",
      },
      {
        t: "list",
        items: [
          "Tick parts and press **Remove selected (n)**, or **Reset all** to empty the list. Both ask for confirmation and clear the current nesting result.",
          "Press a part's **picture** to take one piece and place it by hand (see manual nesting). When its count reaches 0 it cannot be taken again.",
        ],
      },
    ],
  },
  {
    id: "n2-sheets",
    tab: "nesting",
    title: "2D · Sheets & result",
    summary: "Read the result and adjust each sheet.",
    blocks: [
      {
        t: "p",
        text: "Each sheet shows its material, thickness, **number of parts** and **utilization %**. Parts are numbered (#1, #2 …) to match the list. The dashed rectangle is the usable area inside the margin.",
      },
      {
        t: "table",
        head: ["Control", "What it does"],
        rows: [
          ["Cut size (W × H)", "Type the physical size you will actually cut. It cannot be smaller than the parts need or larger than the stock sheet."],
          ["Fit to parts: Width", "Trims only the sheet width to the parts. Height stays as it is."],
          ["Fit to parts: Height", "Trims only the sheet height to the parts. Width stays as it is."],
          ["Fit to parts: Both", "Trims width and height together."],
          ["Reset to full sheet", "Appears after trimming; restores the stock size."],
          ["Clear sheet", "Gives every part on the sheet back to the list (the sheet stays)."],
          ["Delete empty sheet", "Removes a sheet with no parts."],
        ],
      },
      { t: "tip", text: "Trimming sheets shows how much material you really need and lowers scrap." },
      { t: "p", text: "A red **Nesting problems** box lists parts that could not be placed and why (for example, larger than the usable sheet area)." },
    ],
  },
  {
    id: "n2-manual",
    tab: "nesting",
    title: "2D · Nesting by hand",
    summary: "Add sheets, place, move and transfer parts yourself.",
    blocks: [
      {
        t: "steps",
        items: [
          "In **Manual nesting**, choose the material • thickness and press **Add empty sheet**.",
          "Press a part's picture in the table. A piece follows the mouse (a small preview floats next to it).",
          "Move it over a sheet of the same material/thickness and **click to place**. **Esc** cancels.",
          "To move a placed part, **double-click** it to pick it up, move, and click to drop.",
        ],
      },
      {
        t: "list",
        items: [
          "A held part cannot overlap others, break the spacing or enter the margin — it stops at the last allowed position.",
          "Moving it onto another sheet of the same thickness **transfers** it.",
          "Rotation is never blocked. If there is no room the part turns anyway and goes **red**; drag it to a free spot.",
          "While holding: **Rotate 90°**, **Done** (place) and **Put back to list** / **Drop it** buttons appear in the bar above the sheets.",
          "**Delete** on a held part returns it to the list.",
        ],
      },
    ],
  },
  {
    id: "n2-select",
    tab: "nesting",
    title: "2D · Box selection (move groups)",
    summary: "Select several parts like in CAD and move or rotate them together.",
    blocks: [
      {
        t: "list",
        items: [
          "Drag a box on a sheet. **Left → right** (blue) selects only parts completely inside; **right → left** (green, dashed) selects every part the box touches. **Shift** adds to the selection.",
          "Drag any selected part to move them all, or **double-click** one to pick the whole selection up and click to place. You can carry it onto another sheet of the same material/thickness.",
          "**Rotate block 90°** (or **R**) turns the selection as one rigid block; the wheel rotates it freely while you carry it.",
          "**Put back to list** (or **Delete**) removes the selected parts from the sheet. **Clear selection** (or **Esc**) deselects.",
          "Arrow keys nudge the selection one grid cell (Shift = 10 cells).",
        ],
      },
      {
        t: "p",
        text: "The bar with these buttons has a **fixed height**, so the sheets below never jump when it appears or disappears.",
      },
      { t: "tip", text: "On touch screens turn **Touch select on**: dragging on a sheet then draws the selection box instead of scrolling the page." },
    ],
  },
  {
    id: "n2-rotate",
    tab: "nesting",
    title: "2D · Rotating with angle stops",
    summary: "Free rotation with a click at every 45°.",
    blocks: [
      {
        t: "list",
        items: [
          "While holding a part (or a block), the **mouse wheel** rotates it: **5° per notch**, hold **Shift** for **1°**. **R** turns it exactly 90°.",
          "The rotation **stops at every 45°** (0, 45, 90, 135, 180, 225, 270, 315). The next notch carries on from there.",
          "An **angle badge** above the part shows the current angle. On an exact 45° step it turns **green** and the part gets a green outline.",
          "A **click** sounds at each stop — lower and stronger for 0/90/180/270, lighter for the 45° diagonals — and phones that support it vibrate.",
          "Turn the sound off with the **Angle click on/off** button. The stop and the green badge stay.",
        ],
      },
    ],
  },
  {
    id: "n2-undo",
    tab: "nesting",
    title: "2D · Undo & redo",
    summary: "Step back through your hand edits.",
    blocks: [
      {
        t: "keys",
        rows: [
          ["Ctrl + Z (⌘ Z)", "Undo"],
          ["Ctrl + Y  or  Ctrl + Shift + Z", "Redo"],
        ],
      },
      {
        t: "list",
        items: [
          "Also available as the **Undo** and **Redo** buttons next to Add empty sheet.",
          "Covers moving and rotating parts, putting parts back, adding/deleting/clearing sheets and resizing or fitting sheets. Up to 100 steps.",
          "Ignored while a part is in your hand (press Esc first) and inside text/number fields (they keep their own undo).",
          "History starts over when a new result appears (Optimize, Reset all, opening a saved nest). Edits to the parts list itself (quantities, adding/removing parts) are not part of undo.",
        ],
      },
    ],
  },
  {
    id: "n2-save",
    tab: "nesting",
    title: "2D · Save, compare & report",
    summary: "Keep several attempts and export the results.",
    blocks: [
      {
        t: "table",
        head: ["Control", "What it does"],
        rows: [
          ["Name (optional) + Save this nest", "Keeps the current nest with its settings and parts so you can try another. Enter also saves."],
          ["Saved nests", "Table of saved attempts with their utilization so you can compare. **Show** reopens one (settings and parts restored), the pencil renames, the bin deletes."],
          ["Create report (.xlsx)", "Excel report: material used, scrap, parts nested and a picture of every sheet."],
          ["Export DXF", "Nested sheets as a DXF file (in Sheet & settings)."],
        ],
      },
      { t: "warn", text: "Saved nests live in the page only. They are lost when you reload." },
    ],
  },
  {
    id: "n2-keys",
    tab: "nesting",
    title: "2D · Shortcuts cheat-sheet",
    summary: "All mouse and keyboard controls in one place.",
    blocks: [
      {
        t: "keys",
        rows: [
          ["Double-click a part", "Pick it up (or the whole selection)"],
          ["Click", "Place what you hold"],
          ["Mouse wheel", "Rotate 5° (Shift = 1°), stops at every 45°"],
          ["R", "Rotate 90°"],
          ["Arrow keys", "Nudge (Shift = bigger step)"],
          ["Delete / Backspace", "Put the held or selected parts back to the list"],
          ["Esc", "Cancel the pick / clear the selection / cancel the box"],
          ["Drag a box", "Select parts (left→right inside, right→left touching)"],
          ["Shift + box", "Add to the selection"],
          ["Ctrl + Z", "Undo"],
          ["Ctrl + Y / Ctrl + Shift + Z", "Redo"],
        ],
      },
    ],
  },
  {
    id: "n1-import",
    tab: "nesting",
    title: "1D · 1. Import parts",
    summary: "Bars, pipes, angles and channels cut along a length.",
    blocks: [
      {
        t: "list",
        items: [
          "**DXF files** — one part per file, with its cut length filled in. Choose the drawing units first. Then set profile, material and qty in the list.",
          "**CSV** — columns `name, profile, material, length_mm, qty`. **Download the template** from the button below the drop area.",
          "**Import from Standard Calculations** — imports every non-plate part (hot rolled, pipe…) of the selected project with its length and quantity.",
          "**Add a part by hand** in the row at the bottom of the parts table: name, profile (e.g. IPE120), material (e.g. S235), length and qty. Identical parts merge into one row with a higher quantity.",
        ],
      },
      { t: "p", text: "**Reset** removes every part and source (after a confirmation)." },
    ],
  },
  {
    id: "n1-sources",
    tab: "nesting",
    title: "1D · Sources (stock bars)",
    summary: "The bar lengths you can buy for each profile and material.",
    blocks: [
      {
        t: "p",
        text: "A **source** is a stock length available for a profile + material. Sources are created automatically when you import parts; then you enter the data.",
      },
      {
        t: "table",
        head: ["Column", "Meaning"],
        rows: [
          ["Length (mm) *", "Required. Stock bar length."],
          ["Qty", "How many bars are available. Leave empty (∞) for unlimited."],
          ["Cost/bar", "Optional; only used to show the total cost."],
        ],
      },
      { t: "p", text: "You can have several stock lengths for the same profile; the optimiser picks the best mix." },
    ],
  },
  {
    id: "n1-settings",
    tab: "nesting",
    title: "1D · 2. Settings",
    summary: "Saw, trims and layout rules.",
    blocks: [
      {
        t: "table",
        head: ["Setting", "Meaning"],
        rows: [
          ["Saw kerf (mm)", "Material lost between two cuts."],
          ["Gripping (mm)", "Length reserved for the saw clamp."],
          ["Left / Right trim cut (mm)", "Trimmed off each end of the bar."],
          ["Minimize layout (pattern) count", "Reuse existing cutting patterns instead of chasing the least waste — fewer saw set-ups, a little more scrap."],
          ["Max parts in layout", "Most cuts on one bar (0 = no limit)."],
          ["Max distinct lengths in layout", "Most different lengths on one bar (0 = no limit)."],
          ["Min length diff among parts", "Two different lengths share a bar only if they differ by at least this."],
          ["Restricted rest length From / To", "Leftovers in this range are flagged as an unusable “dead” rest (0 / 0 disables)."],
          ["Minimal remnant length", "Leftovers this long or longer are kept as reusable remnants; shorter is scrap."],
        ],
      },
      { t: "p", text: "Press **Optimize cutting** to run. Errors appear in red under the button." },
    ],
  },
  {
    id: "n1-results",
    tab: "nesting",
    title: "1D · Results & exports",
    summary: "Layouts, yield, cut lists and the Excel report.",
    blocks: [
      {
        t: "list",
        items: [
          "Summary tiles: **Yield**, **Bars used**, **Layouts**, **Cut parts**, **Total bar length**, **Total cost**.",
          "Identical bars are grouped into **layouts** with a repeat count — set the saw once and repeat.",
          "Each bar shows its length: type a shorter length or press **Fit to cuts** to shrink it to just fit its cuts (less material, less scrap); **Reset to stock length** restores it.",
          "Warnings appear for pieces that could not be cut (longer than any stock) and for “dead” rests.",
          "**cut-list.txt** and **cut-list.csv** buttons export the cutting list. **Create report (.xlsx)** exports bars used, scrap, parts cut, cut list and a picture of every layout.",
        ],
      },
    ],
  },
  {
    id: "n-combined",
    tab: "nesting",
    title: "Combined report (1D + 2D)",
    summary: "One Excel file with both tools.",
    blocks: [
      {
        t: "p",
        text: "At the bottom of the tab, **Create combined report (.xlsx)** produces one workbook with plates (2D) and bars/pipes (1D): overview, material used, scrap, parts and layout pictures. Run the nesting first; the report uses the current results.",
      },
    ],
  },

  // --------------------------------------------------------------------- SCRAP
  {
    id: "sm-overview",
    tab: "scrap",
    title: "Overview",
    summary: "From nesting result to purchased material, scrap and value.",
    blocks: [
      {
        t: "p",
        text: "**Scrap & Material** takes the project's current nesting result and works out what you bought, what you used, what can be **used later** and what is **actual scrap**, together with cost and value. It follows the material flow: Purchased → Used → Primary scrap → (Used later / Actual scrap).",
      },
      {
        t: "warn",
        text: "The tab uses the project's saved nesting result. If you see **No nesting yet** or **Nesting not run yet**, there is no completed nesting stored for the selected project.",
      },
    ],
  },
  {
    id: "sm-inputs",
    tab: "scrap",
    title: "Inputs",
    summary: "The four prices and percentages you control.",
    blocks: [
      {
        t: "table",
        head: ["Input", "Default", "Meaning"],
        rows: [
          ["Cost/kg (LE)", "46", "What you pay for the steel."],
          ["% Used Later", "0", "Share of the leftover that you keep and reuse."],
          ["Used Later Price (LE/kg)", "46", "Value of that reused material."],
          ["Scrap Selling Price (LE/kg)", "15", "Price you get when scrap is sold."],
        ],
      },
      { t: "p", text: "Press **Calculate** after changing any input." },
    ],
  },
  {
    id: "sm-results",
    tab: "scrap",
    title: "Results",
    summary: "Totals, per-material table and the formulas.",
    blocks: [
      {
        t: "p",
        text: "The tiles show totals across the nesting result. Below them a table has **one row per material/thickness**. Hover any heading or tile for its formula.",
      },
      {
        t: "table",
        head: ["Value", "Formula"],
        rows: [
          ["Used Area / Weight", "Straight from the nesting result (real nested area)"],
          ["Buy Weight", "From the number of sheets that had to be purchased"],
          ["Primary Scrap %", "1 − (Used Wt ÷ Buy Wt)"],
          ["Used Later Wt", "(Buy Wt − Used Wt) × % Used Later"],
          ["Actual Scrap Wt", "Buy Wt − Used Wt − Used Later Wt"],
          ["Buy Cost", "Cost/kg × Buy Wt"],
          ["Used Later Value", "Used Later Wt × Used Later Price"],
          ["Scrap Value", "Actual Scrap Wt × Scrap Selling Price"],
          ["Actual Scrap %", "1 − (Value Used ÷ Buy Cost)"],
        ],
      },
      { t: "tip", text: "**Show Formulas** (totals) and the button on each row open a dialog that shows the equation with your numbers. A negative Actual Scrap % (green) means you recover more than you spent." },
    ],
  },
  {
    id: "sm-export",
    tab: "scrap",
    title: "Export to Excel",
    summary: "Download the pricing as a workbook.",
    blocks: [
      {
        t: "p",
        text: "**Export to Excel** (after calculating) creates a workbook that mirrors the reference pricing sheet, with a **Part List** sheet and a **Nesting** sheet. Formulas stay live where the reference keeps them live. Needs the Scrap & Material export permission (Admin, Manager, Engineer).",
      },
    ],
  },

  // ------------------------------------------------------------------- PRICING
  {
    id: "sp-overview",
    tab: "pricing",
    title: "Overview",
    summary: "Price a full BOQ from an editable rate card.",
    blocks: [
      {
        t: "p",
        text: "**Steel Pricing** follows the workbook *Cost Estimation – Steel Structure* (sheet BOQ – Full). It has three parts: **1. Pricing setup**, **2. Item pricing calculator** and **3. Full BOQ**, plus a sticky summary bar at the top.",
      },
      {
        t: "table",
        head: ["Summary tile", "Meaning"],
        rows: [
          ["Supply & fabrication", "Sale price of material and fabrication"],
          ["Dismantle & installation", "Site activity sale price"],
          ["Additional costs*", "Extras included in the grand total"],
          ["Tax & insurance*", "Included in the grand total"],
          ["Grand total (EGP)", "Final price of the whole BOQ"],
          ["Total cost† / Total profit† / Profit %†", "Only for items that have a cost build-up (fixed-price and unpriced items are excluded)"],
        ],
      },
      {
        t: "list",
        items: [
          "Everything updates **live** as you edit.",
          "All edits are **saved in this browser** (not on the server) and come back next time.",
          "**Reset to workbook** appears once you changed anything and restores every rate, material price and BOQ edit to the workbook defaults (after a confirmation).",
        ],
      },
    ],
  },
  {
    id: "sp-setup",
    tab: "pricing",
    title: "1. Pricing setup",
    summary: "Every rate the price is built from.",
    blocks: [
      {
        t: "p",
        text: "Rates are grouped by stage. Edit a value and every item, subtotal and the grand total update immediately. Many rates have alternative **profiles A–E**; each BOQ item uses the profile the workbook assigns to it (you can change it per item).",
      },
      {
        t: "table",
        head: ["Group", "What you set"],
        rows: [
          ["Materials", "Material handling %, accessories % (profile A / B), material prices (EGP), scrap"],
          ["Fabrication", "Cutting (EGP/t), fit-up & welding (EGP/t), painting per ton (EGP/t) **or** per m² (EGP/m²), NDT (% of fabrication), fabrication indirect (%)"],
          ["Margins", "Supply & fabrication multipliers on material, fabrication, NDT and painting"],
          ["Installation", "EGP/ton per activity for profiles A–E: transport, handling, packing, crane, scaffolding, man hour, safety, tools, PPE, touch-up, weld surveyor; installation indirect (%) and installation margin (×)"],
          ["Additional costs", "% of the supply + installation sale price (site items only): mobilisation/demobilisation, height factor, third-party certificate, commissioning"],
          ["Tax & insurance", "Divisors: price ÷ divisor"],
        ],
      },
      { t: "note", text: "**Painting per m²** starts empty (it is not in the workbook). Enter it, and the painted area, to price painting by area." },
    ],
  },
  {
    id: "sp-calc",
    tab: "pricing",
    title: "2. Item pricing calculator",
    summary: "Price a typical item with the same engine as the BOQ.",
    blocks: [
      {
        t: "steps",
        items: [
          "Choose the **Material** and the **Scope** (Supply or Site Activity).",
          "Choose the **Installation rate profile** and enter the **Quantity** (the unit follows the material).",
          "Choose the **Painting price** basis (per ton or per m², with an area if per m²).",
          "Read the **Price build-up**: cost per stage and the **Total cost**.",
        ],
      },
    ],
  },
  {
    id: "sp-boq",
    tab: "pricing",
    title: "3. Full BOQ",
    summary: "Every item, editable, with a full breakdown on click.",
    blocks: [
      {
        t: "list",
        items: [
          "**Search** by item number or description.",
          "**Click a row** to open exactly how its price is built.",
          "Edit the **quantity**, **material** or **installation profile** of any row. A dot marks edited rows; **Reset to workbook values** undoes them.",
          "Use **Rate profile per activity** inside a row to see the effect of another profile.",
          "**Fixed price** items keep the workbook price; some items are “priced-like” another item and reuse its unit price with a multiplier.",
          "If painting is by area, enter the area on the row; a red hint (“no m² price” / “no area”) tells you what is missing.",
        ],
      },
    ],
  },
  {
    id: "sp-breakdown",
    tab: "pricing",
    title: "How an item price is built",
    summary: "The five stages shown in a row's breakdown.",
    blocks: [
      {
        t: "steps",
        items: [
          "**Material cost** — material price + handling + scrap + accessories.",
          "**Fabrication cost** — cutting, fit-up & welding, NDT, painting and fabrication indirect. The **supply & fabrication sale price** applies the margin multipliers.",
          "**Installation cost** — each activity by profile, plus installation indirect. **Installation sale price** = (direct + indirect) × installation margin.",
          "**Additional costs** — mobilisation/demobilisation, height factor, third-party certificate and commissioning, applied where the workbook applies them.",
          "**Tax & insurance** — price ÷ the tax and insurance divisors. The card ends with the **Final price**, unit price and total cost.",
        ],
      },
      { t: "note", text: "Exporting a priced workbook from this tool needs the Scrap & Material export permission." },
    ],
  },
];
