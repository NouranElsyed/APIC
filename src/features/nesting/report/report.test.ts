import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildReport1D } from "./report-1d";
import { buildReport2D } from "./report-2d";
import { runOptimize1D, addPiece, addSource, type Counters1D, type Piece1D, type Source1D, type Settings1D } from "../nest-boost-1d/engine";
import type { Group, OptResult, Settings } from "../nest-boost/engine";

// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function load(blob: Blob) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await blob.arrayBuffer()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

describe("1D report", () => {
  const S: Settings1D = { kerf: 3, leftTrim: 10, rightTrim: 10, gripping: 0, minimizeLayoutCount: false, maxPartsInLayout: 0, maxDistinctLengthsInLayout: 0, minLengthDiffInLayout: 0, remnantMinLength: 300, restrictedRestFrom: 0, restrictedRestTo: 0 };
  it("builds all sheets with consistent totals", async () => {
    const pc: Counters1D = { id: 0, sn: 0 };
    const sc: Counters1D = { id: 100, sn: 0 };
    let pieces: Piece1D[] = [];
    pieces = addPiece(pieces, { name: "A", profile: "IPE120", material: "S235", length: 2450, qty: 4 }, pc);
    pieces = addPiece(pieces, { name: "B", profile: "IPE120", material: "S235", length: 1000, qty: 3 }, pc);
    let sources: Source1D[] = [];
    sources = addSource(sources, { profile: "IPE120", material: "S235", length: 6000, qty: null, cost: 100, description: "" }, sc);
    const result = runOptimize1D(pieces, sources, S);
    const blob = await buildReport1D({ projectName: "P1", result, S, pieces, sources, renderBar: () => ({ dataUrl: PNG, width: 1200, height: 44 }) });
    const wb = await load(blob);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Layouts", "Cut list", "Parts", "Layout images"]);
    const parts = wb.getWorksheet("Parts")!;
    // required 4+3, all cut
    expect(parts.getRow(2).getCell(6).value).toBe(4);
    expect(parts.getRow(2).getCell(8).value).toBe(0);
    expect(wb.getWorksheet("Layout images")!.getImages().length).toBe(result.layouts.length);
  });
});

describe("2D report", () => {
  it("computes used/scrap area and weight per sheet", async () => {
    const S: Settings = { W: 2000, H: 1000, mg: 5, gp: 5, cell: 5, ro: 2, x0: 0, GW: 0, GH: 0 };
    const g: Group = { id: 1, sn: 1, name: "Plate A", qty: 3, th: 10, material: "S235", outer: [], holes: [], w: 500, h: 400, area: 200000, per: 0 };
    const item = (x: number) => ({ g, rot: 0, x, y: 0 });
    const result: OptResult = { sheets: [{ items: [item(0), item(600), item(1200)], th: 10, material: "S235", used: 0 }], un: [], skip: [] };
    const blob = await buildReport2D({ result, S, groups: [g], renderSheet: () => ({ dataUrl: PNG, width: 1000, height: 500 }) });
    const wb = await load(blob);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Sheets", "Parts", "Layouts"]);
    const sh = wb.getWorksheet("Sheets")!.getRow(2);
    expect(sh.getCell(7).value).toBe(2); // sheet m2
    expect(sh.getCell(8).value).toBe(0.6); // used m2 = 3 x 0.2
    expect(sh.getCell(9).value).toBe(1.4); // scrap m2
    expect(sh.getCell(14).value).toBe(109.9); // scrap kg = 1.4 * 10 * 7.85
    expect(wb.getWorksheet("Parts")!.getRow(2).getCell(6).value).toBe(3);
    expect(wb.getWorksheet("Layouts")!.getImages().length).toBe(1);
  });
});

import { buildReportCombined } from "./report-combined";

describe("combined report", () => {
  it("has an Overview plus prefixed 2D and 1D sheets", async () => {
    const S2: Settings = { W: 2000, H: 1000, mg: 5, gp: 5, cell: 5, ro: 2, x0: 0, GW: 0, GH: 0 };
    const g: Group = { id: 1, sn: 1, name: "Plate A", qty: 1, th: 10, material: "S235", outer: [], holes: [], w: 500, h: 400, area: 200000, per: 0 };
    const d2 = { result: { sheets: [{ items: [{ g, rot: 0, x: 0, y: 0 }], th: 10, material: "S235", used: 0 }], un: [], skip: [] } as OptResult, S: S2, groups: [g] };

    const S1: Settings1D = { kerf: 3, leftTrim: 10, rightTrim: 10, gripping: 0, minimizeLayoutCount: false, maxPartsInLayout: 0, maxDistinctLengthsInLayout: 0, minLengthDiffInLayout: 0, remnantMinLength: 300, restrictedRestFrom: 0, restrictedRestTo: 0 };
    const pc: Counters1D = { id: 0, sn: 0 };
    const pieces = addPiece([], { name: "A", profile: "FB50x10", material: "S235", length: 1000, qty: 5 }, pc);
    const sources = addSource([], { profile: "FB50x10", material: "S235", length: 6000, qty: null, cost: 0, description: "" }, { id: 100, sn: 0 });
    const d1 = { result: runOptimize1D(pieces, sources, S1), S: S1, pieces, sources };

    const wb = await load(await buildReportCombined({ projectName: "P", d2, d1 }));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Overview", "2D Summary", "2D Sheets", "2D Parts", "1D Summary", "1D Layouts", "1D Cut list", "1D Parts",
    ]);
    const ov = wb.getWorksheet("Overview")!;
    const methods: string[] = [];
    ov.eachRow((row) => { const v = row.getCell(1).value; if (v === "2D" || v === "1D") methods.push(String(v)); });
    expect(methods).toEqual(["2D", "1D"]);
    // 2D only still works
    const only2 = await load(await buildReportCombined({ d2 }));
    expect(only2.worksheets.map((w) => w.name)).toEqual(["Overview", "2D Summary", "2D Sheets", "2D Parts"]);
  });
});
