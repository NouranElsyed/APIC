import ExcelJS from "exceljs";
import { barStats, type Piece1D, type Result1D, type Settings1D, type Source1D } from "../nest-boost-1d/engine";
import { addImageAt, addKeyValues, addTable, addTitle, pct, round, sheetName, stamp, workbookToBlob, type Cell, type OverviewRow } from "./excel-common";

export interface Report1DInput {
  projectName?: string;
  result: Result1D;
  S: Settings1D;
  pieces: Piece1D[];
  sources: Source1D[];
  /** PNG of one layout's bar (canvas). Optional — omitted in tests / no-DOM. */
  renderBar?: (layoutIndex: number) => { dataUrl: string; width: number; height: number } | null;
}

const m = (mm: number) => round(mm / 1000, 3); // mm -> metres

/** Adds the 1D report sheets to `wb` (names prefixed with `prefix`) and returns its overview lines. */
export function add1DSheets(wb: ExcelJS.Workbook, input: Report1DInput, prefix = ""): OverviewRow[] {
  const { result, S, pieces, sources } = input;
  const nm = (n: string) => sheetName(prefix, n);

  // Per layout numbers (bars[0] is representative; all bars in a layout are identical).
  const layouts = result.layouts.map((l, i) => {
    const b = l.bars[0];
    const L = b.length ?? b.sourceLength;
    const st = barStats(b, S);
    const partsLen = b.cuts.reduce((s, c) => s + c.piece.length, 0);
    const waste = Math.max(0, L - partsLen);
    const remnant = st.isRemnant ? st.rest : 0;
    return {
      no: i + 1, b, L, repeat: l.repeat, st, partsLen, waste, remnant, netScrap: Math.max(0, waste - remnant),
    };
  });

  // ---------------------------------------------------------------- Summary
  const ws = wb.addWorksheet(nm("Summary"));
  let r = addTitle(ws, 1, "Nesting Report — 1D (bars, pipes & profiles)", 16);
  r = addKeyValues(ws, r, [
    ["Project", input.projectName || "—"],
    ["Date", stamp()],
    ["Saw kerf", `${S.kerf} mm`],
    ["Trims (left / right / grip)", `${S.leftTrim} / ${S.rightTrim} / ${S.gripping} mm`],
    ["Remnant kept from", `${S.remnantMinLength} mm`],
  ]) + 1;

  const byProf = new Map<string, typeof layouts>();
  for (const x of layouts) {
    const k = `${x.b.profile || "—"}|${x.b.material || "—"}`;
    byProf.set(k, [...(byProf.get(k) ?? []), x]);
  }
  const sum = (list: typeof layouts, f: (x: (typeof layouts)[number]) => number) => list.reduce((s, x) => s + f(x) * x.repeat, 0);
  const costById = new Map(sources.map((s) => [s.id, s.cost]));
  const profRows: Cell[][] = [...byProf.entries()].map(([k, list]) => {
    const [profile, material] = k.split("|");
    const bars = list.reduce((s, x) => s + x.repeat, 0);
    const barLen = sum(list, (x) => x.L);
    const parts = sum(list, (x) => x.partsLen);
    const rem = sum(list, (x) => x.remnant);
    const net = sum(list, (x) => x.netScrap);
    const cost = list.reduce((s, x) => s + (costById.get(x.b.sourceId) ?? 0) * x.repeat, 0);
    return [profile, material, bars, m(barLen), m(parts), m(rem), m(net), pct(parts, barLen), pct(net, barLen), cost || null];
  });
  const allBarLen = sum(layouts, (x) => x.L);
  const allParts = sum(layouts, (x) => x.partsLen);
  const allNet = sum(layouts, (x) => x.netScrap);
  r = addTitle(ws, r, "Material used", 12);
  r = addTable(
    ws, r,
    [
      { header: "Profile", width: 24 }, { header: "Material", width: 18 },
      { header: "Bars used", sum: true },
      { header: "Total bar length (m)", fmt: "#,##0.000", sum: true },
      { header: "Parts length (m)", fmt: "#,##0.000", sum: true },
      { header: "Reusable remnants (m)", fmt: "#,##0.000", sum: true },
      { header: "Net scrap (m)", fmt: "#,##0.000", sum: true },
      { header: "Yield %", fmt: "0.0" }, { header: "Scrap %", fmt: "0.0" },
      { header: "Cost", fmt: "#,##0.00", sum: true },
    ],
    profRows,
    { label: "TOTAL", overrides: { 7: pct(allParts, allBarLen), 8: pct(allNet, allBarLen) } },
  );

  // Stock actually used: how many bars of which length.
  const stock = new Map<string, { profile: string; material: string; len: number; count: number }>();
  for (const x of layouts) {
    const k = `${x.b.profile}|${x.b.material}|${x.L}`;
    const cur = stock.get(k) ?? { profile: x.b.profile || "—", material: x.b.material || "—", len: x.L, count: 0 };
    cur.count += x.repeat;
    stock.set(k, cur);
  }
  r = addTitle(ws, r, "Stock bars to use", 12);
  r = addTable(
    ws, r,
    [
      { header: "Profile", width: 24 }, { header: "Material", width: 18 },
      { header: "Bar length (mm)", fmt: "#,##0" }, { header: "Bars", sum: true },
      { header: "Total length (m)", fmt: "#,##0.000", sum: true },
    ],
    [...stock.values()].map((s) => [s.profile, s.material, Math.round(s.len), s.count, m(s.len * s.count)]),
    { label: "TOTAL" },
  );

  if (result.skip.length || result.problems.length) {
    r = addTitle(ws, r, "Not nested / warnings", 12);
    for (const t of [...result.skip, ...result.problems]) ws.getCell(r++, 1).value = t;
  }

  // ---------------------------------------------------------------- Layouts
  const wsL = wb.addWorksheet(nm("Layouts"), { views: [{ state: "frozen", ySplit: 1 }] });
  addTable(
    wsL, 1,
    [
      { header: "Layout #" }, { header: "Profile", width: 22 }, { header: "Material", width: 16 },
      { header: "Bar length (mm)", fmt: "#,##0" }, { header: "Bars (repeat)", sum: true }, { header: "Parts / bar" },
      { header: "Parts length / bar (mm)", fmt: "#,##0" }, { header: "Waste / bar (mm)", fmt: "#,##0" },
      { header: "Reusable remnant / bar (mm)", fmt: "#,##0" }, { header: "Net scrap / bar (mm)", fmt: "#,##0" },
      { header: "Utilization %", fmt: "0.0" }, { header: "Scrap %", fmt: "0.0" },
    ],
    layouts.map((x) => [
      x.no, x.b.profile || "—", x.b.material || "—", Math.round(x.L), x.repeat, x.st.pieces,
      Math.round(x.partsLen), Math.round(x.waste), Math.round(x.remnant), Math.round(x.netScrap),
      pct(x.partsLen, x.L), pct(x.netScrap, x.L),
    ]),
    { label: "TOTAL" },
  );

  // --------------------------------------------------------------- Cut list
  const wsC = wb.addWorksheet(nm("Cut list"), { views: [{ state: "frozen", ySplit: 1 }] });
  const cutRows: Cell[][] = [];
  for (const x of layouts)
    x.b.cuts
      .slice()
      .sort((a, c) => a.pos - c.pos)
      .forEach((c) =>
        cutRows.push([x.no, x.repeat, x.b.profile || "—", x.b.material || "—", Math.round(x.L), c.piece.sn, c.piece.name, Math.round(c.piece.length), Math.round(c.pos)]),
      );
  addTable(
    wsC, 1,
    [
      { header: "Layout #" }, { header: "Bars (repeat)" }, { header: "Profile", width: 22 }, { header: "Material", width: 16 },
      { header: "Bar length (mm)", fmt: "#,##0" }, { header: "Part #" }, { header: "Part name", width: 40 },
      { header: "Cut length (mm)", fmt: "#,##0" }, { header: "Position (mm)", fmt: "#,##0" },
    ],
    cutRows,
  );

  // ------------------------------------------------------------------ Parts
  const cutCount = new Map<number, number>();
  for (const x of layouts) for (const c of x.b.cuts) cutCount.set(c.piece.id, (cutCount.get(c.piece.id) ?? 0) + x.repeat);
  const wsP = wb.addWorksheet(nm("Parts"), { views: [{ state: "frozen", ySplit: 1 }] });
  addTable(
    wsP, 1,
    [
      { header: "Part #" }, { header: "Name", width: 40 }, { header: "Profile", width: 22 }, { header: "Material", width: 16 },
      { header: "Length (mm)", fmt: "#,##0.##" }, { header: "Required", sum: true }, { header: "Cut", sum: true },
      { header: "Not cut", sum: true }, { header: "Total cut length (m)", fmt: "#,##0.000", sum: true },
    ],
    pieces
      .filter((p) => p.qty > 0)
      .map((p) => {
        const n = cutCount.get(p.id) ?? 0;
        return [p.sn, p.name, p.profile || "—", p.material || "—", p.length, p.qty, n, Math.max(0, p.qty - n), m(n * p.length)];
      }),
    { label: "TOTAL" },
  );

  // ----------------------------------------------------------------- Images
  if (input.renderBar && layouts.length) {
    const wsI = wb.addWorksheet(nm("Layout images"));
    let lr = addTitle(wsI, 1, "Cutting layouts", 14) + 1;
    for (let i = 0; i < layouts.length; i++) {
      const x = layouts[i];
      wsI.getCell(lr, 1).value = `Layout ${x.no} — ${x.b.profile || "—"} ${x.b.material || ""} — ${Math.round(x.L)} mm bar × ${x.repeat} — ${x.st.pieces} pcs/bar — utilization ${pct(x.partsLen, x.L)}%`;
      wsI.getCell(lr, 1).font = { bold: true };
      lr++;
      const img = input.renderBar(i);
      if (img) lr = addImageAt(wb, wsI, img.dataUrl, lr, img.width, img.height);
    }
  }

  return profRows.map((x) => ({
    kind: "1D" as const,
    material: String(x[1]),
    item: String(x[0]),
    count: Number(x[2]),
    unit: "bars" as const,
    utilPct: Number(x[7]),
    scrapPct: Number(x[8]),
    scrapQty: Number(x[6]),
    scrapUnit: "m" as const,
    scrapKg: null,
  }));
}

export async function buildReport1D(input: Report1DInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  add1DSheets(wb, input);
  return workbookToBlob(wb);
}
