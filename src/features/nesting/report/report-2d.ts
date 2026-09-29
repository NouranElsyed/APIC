import ExcelJS from "exceljs";
import type { Group, OptResult, Settings } from "../nest-boost/engine";
import { addImageAt, addKeyValues, addTable, addTitle, pct, round, sheetName, stamp, workbookToBlob, type Cell, type OverviewRow } from "./excel-common";

/** Steel plate weight factor: kg per (m² · mm) — same constant as Standard Calculations. */
const DENSITY = 7.85;

export interface Report2DInput {
  projectName?: string;
  result: OptResult;
  S: Settings;
  /** All parts currently loaded in the tool (for required vs placed). */
  groups: Group[];
  /** Returns a PNG data URL of sheet i (canvas). Optional — omitted in tests / no-DOM. */
  renderSheet?: (index: number) => { dataUrl: string; width: number; height: number } | null;
}

interface SheetRow {
  no: number;
  material: string;
  th: number;
  W: number;
  H: number;
  parts: number;
  sheetM2: number;
  usedM2: number;
  scrapM2: number;
  sheetKg: number | null;
  usedKg: number | null;
  scrapKg: number | null;
}

const kg = (m2: number, th: number) => (th > 0 ? round(m2 * th * DENSITY, 2) : null);

export function collectSheetRows(result: OptResult, S: Settings): SheetRow[] {
  return result.sheets.map((sh, i) => {
    const W = sh.W ?? S.W;
    const H = sh.H ?? S.H;
    const sheetM2 = (W * H) / 1e6;
    const usedM2 = sh.items.reduce((s, it) => s + it.g.area, 0) / 1e6;
    const scrapM2 = Math.max(0, sheetM2 - usedM2);
    return {
      no: i + 1,
      material: sh.material || "—",
      th: sh.th,
      W: Math.round(W),
      H: Math.round(H),
      parts: sh.items.reduce((s, it) => s + (it.g.n || 1), 0),
      sheetM2: round(sheetM2),
      usedM2: round(usedM2),
      scrapM2: round(scrapM2),
      sheetKg: kg(sheetM2, sh.th),
      usedKg: kg(usedM2, sh.th),
      scrapKg: kg(scrapM2, sh.th),
    };
  });
}

const num = (v: number | null) => v ?? 0;

/** Adds the 2D report sheets to `wb` (names prefixed with `prefix`) and returns its overview lines. */
export function add2DSheets(wb: ExcelJS.Workbook, input: Report2DInput, prefix = ""): OverviewRow[] {
  const { result, S, groups } = input;
  const nm = (n: string) => sheetName(prefix, n);
  const rows = collectSheetRows(result, S);

  // ---------------------------------------------------------------- Summary
  const ws = wb.addWorksheet(nm("Summary"));
  let r = addTitle(ws, 1, "Nesting Report — 2D (plates)", 16);
  r = addKeyValues(ws, r, [
    ["Project", input.projectName || "—"],
    ["Date", stamp()],
    ["Stock sheet", `${S.W} × ${S.H} mm`],
    ["Edge margin / part gap", `${S.mg} mm / ${S.gp} mm`],
  ]) + 1;

  const byMat = new Map<string, SheetRow[]>();
  for (const x of rows) {
    const k = `${x.material}|${x.th}`;
    byMat.set(k, [...(byMat.get(k) ?? []), x]);
  }
  const matRows: Cell[][] = [...byMat.values()].map((list) => {
    const f = list[0];
    const sheetM2 = list.reduce((s, x) => s + x.sheetM2, 0);
    const usedM2 = list.reduce((s, x) => s + x.usedM2, 0);
    const scrapM2 = list.reduce((s, x) => s + x.scrapM2, 0);
    return [
      f.material, f.th || null, list.length, list.reduce((s, x) => s + x.parts, 0),
      round(sheetM2), round(usedM2), round(scrapM2), pct(usedM2, sheetM2), pct(scrapM2, sheetM2),
      f.th ? round(list.reduce((s, x) => s + num(x.sheetKg), 0), 2) : null,
      f.th ? round(list.reduce((s, x) => s + num(x.usedKg), 0), 2) : null,
      f.th ? round(list.reduce((s, x) => s + num(x.scrapKg), 0), 2) : null,
    ];
  });
  const T = rows.reduce(
    (a, x) => ({ sheet: a.sheet + x.sheetM2, used: a.used + x.usedM2, scrap: a.scrap + x.scrapM2 }),
    { sheet: 0, used: 0, scrap: 0 },
  );
  r = addTitle(ws, r, "Material used", 12);
  r = addTable(
    ws, r,
    [
      { header: "Material", width: 22 },
      { header: "Thickness (mm)", fmt: "0.##" },
      { header: "Sheets used", sum: true },
      { header: "Parts nested", sum: true },
      { header: "Sheet area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Used area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Scrap area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Utilization %", fmt: "0.0" },
      { header: "Scrap %", fmt: "0.0" },
      { header: "Sheet weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "Used weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "Scrap weight (kg)", fmt: "#,##0.00", sum: true },
    ],
    matRows,
    { label: "TOTAL", overrides: { 7: pct(T.used, T.sheet), 8: pct(T.scrap, T.sheet) } },
  );

  if (result.skip.length || result.un.length) {
    r = addTitle(ws, r, "Not nested / warnings", 12);
    for (const g of result.un) ws.getCell(r++, 1).value = `#${g.sn} ${g.name} (${g.material || "—"}, ${g.th || "?"} mm) — could not be placed`;
    for (const m of result.skip) ws.getCell(r++, 1).value = m;
  }

  // ----------------------------------------------------------------- Sheets
  const wsS = wb.addWorksheet(nm("Sheets"), { views: [{ state: "frozen", ySplit: 1 }] });
  addTable(
    wsS, 1,
    [
      { header: "Sheet #" }, { header: "Material", width: 22 }, { header: "Thickness (mm)", fmt: "0.##" },
      { header: "Width (mm)" }, { header: "Height (mm)" }, { header: "Parts", sum: true },
      { header: "Sheet area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Used area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Scrap area (m²)", fmt: "#,##0.000", sum: true },
      { header: "Utilization %", fmt: "0.0" }, { header: "Scrap %", fmt: "0.0" },
      { header: "Sheet weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "Used weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "Scrap weight (kg)", fmt: "#,##0.00", sum: true },
    ],
    rows.map((x) => [
      x.no, x.material, x.th || null, x.W, x.H, x.parts, x.sheetM2, x.usedM2, x.scrapM2,
      pct(x.usedM2, x.sheetM2), pct(x.scrapM2, x.sheetM2), x.sheetKg, x.usedKg, x.scrapKg,
    ]),
    { label: "TOTAL", overrides: { 9: pct(T.used, T.sheet), 10: pct(T.scrap, T.sheet) } },
  );

  // ------------------------------------------------------------------ Parts
  const placed = new Map<number, number>();
  const onSheets = new Map<number, Set<number>>();
  result.sheets.forEach((sh, si) =>
    sh.items.forEach((it) => {
      const key = it.g.cid ?? it.g.id; // paired triangles count for the single-triangle part they came from
      placed.set(key, (placed.get(key) ?? 0) + (it.g.n || 1));
      onSheets.set(key, (onSheets.get(key) ?? new Set()).add(si + 1));
    }),
  );
  const wsP = wb.addWorksheet(nm("Parts"), { views: [{ state: "frozen", ySplit: 1 }] });
  const partRows: Cell[][] = groups
    .filter((g) => g.qty > 0 || placed.has(g.id))
    .map((g) => {
      const p = placed.get(g.id) ?? 0;
      const areaEach = g.area / 1e6;
      return [
        g.sn, g.name, g.material || "—", g.th || null, g.qty, p, Math.max(0, g.qty - p),
        round(areaEach, 4), round(areaEach * p), kg(areaEach * p, g.th),
        [...(onSheets.get(g.id) ?? [])].sort((a, b) => a - b).join(", "),
      ];
    });
  addTable(
    wsP, 1,
    [
      { header: "Part #" }, { header: "Name", width: 40 }, { header: "Material", width: 20 },
      { header: "Thickness (mm)", fmt: "0.##" }, { header: "Required", sum: true }, { header: "Nested", sum: true },
      { header: "Not nested", sum: true }, { header: "Area each (m²)", fmt: "#,##0.0000" },
      { header: "Nested area (m²)", fmt: "#,##0.000", sum: true }, { header: "Nested weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "On sheets", width: 18 },
    ],
    partRows,
    { label: "TOTAL" },
  );

  // ---------------------------------------------------------------- Layouts
  if (input.renderSheet && result.sheets.length) {
    const wsL = wb.addWorksheet(nm("Layouts"));
    let lr = addTitle(wsL, 1, "Sheet layouts", 14) + 1;
    for (let i = 0; i < result.sheets.length; i++) {
      const img = input.renderSheet(i);
      const x = rows[i];
      wsL.getCell(lr, 1).value = `Sheet ${x.no} — ${x.material}${x.th ? ` — ${x.th} mm` : ""} — ${x.W}×${x.H} mm — ${x.parts} parts — utilization ${pct(x.usedM2, x.sheetM2)}% — scrap ${x.scrapM2} m²${x.scrapKg != null ? ` (${x.scrapKg} kg)` : ""}`;
      wsL.getCell(lr, 1).font = { bold: true };
      lr++;
      if (img) lr = addImageAt(wb, wsL, img.dataUrl, lr, img.width, img.height);
    }
  }

  return matRows.map((x) => ({
    kind: "2D" as const,
    material: String(x[0]),
    item: x[1] ? `${x[1]} mm` : "—",
    count: Number(x[2]),
    unit: "sheets" as const,
    utilPct: Number(x[7]),
    scrapPct: Number(x[8]),
    scrapQty: Number(x[6]),
    scrapUnit: "m²" as const,
    scrapKg: x[11] == null ? null : Number(x[11]),
  }));
}

export async function buildReport2D(input: Report2DInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  add2DSheets(wb, input);
  return workbookToBlob(wb);
}
