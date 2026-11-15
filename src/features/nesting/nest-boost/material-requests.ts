// Turns a finished 2D nest into material requests ("what must we order, scrap included").
// One line per stock sheet size / thickness / material: the number of sheets the nest needs, with the weight
// that is parts and the weight that is scrap, so purchasing can order exactly what was nested.
import { isExact, type OptResult, type Settings } from "./engine";

const STEEL_KG_PER_M2_MM = 7.85;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface MaterialRequestLine {
  /** Stable key per sheet size, so sending the nest again updates the line instead of duplicating it. */
  code: string;
  description: string;
  spec: string;
  sheets: number;
  /** Stock sheet size, mm */
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  material: string;
  /** kg: whole stock sheets / the parts cut from them / what is left over */
  sheetKg: number | null;
  partsKg: number | null;
  scrapKg: number | null;
  scrapPct: number | null;
  /** Pieces on these sheets that are exact vs approximate (see Group.exact) */
  exactPieces: number;
  approxPieces: number;
}

export function buildMaterialRequests(result: OptResult, S: Pick<Settings, "W" | "H">): MaterialRequestLine[] {
  const map = new Map<string, MaterialRequestLine>();
  for (const sh of result.sheets) {
    // order the STOCK sheet: a trimmed sheet (sh.W / sh.H) is still cut from a full one
    const W = Math.round(sh.stockW ?? S.W);
    const H = Math.round(sh.stockH ?? S.H);
    const th = sh.th > 0 ? sh.th : 0;
    const material = (sh.material ?? "").trim();
    const code = `NEST-${th || 0}-${material || "ANY"}-${W}x${H}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
    const line = map.get(code) ?? {
      code,
      description: `Steel plate${th ? ` ${th} mm` : ""}${material ? ` ${material}` : ""}`,
      spec: `${W} × ${H} mm sheet`,
      sheets: 0, widthMm: W, heightMm: H, thicknessMm: th, material,
      sheetKg: th ? 0 : null, partsKg: th ? 0 : null, scrapKg: th ? 0 : null, scrapPct: null,
      exactPieces: 0, approxPieces: 0,
    };
    line.sheets += 1;
    let partsMm2 = 0;
    for (const it of sh.items) {
      partsMm2 += it.g.area;
      if (isExact(it.g)) line.exactPieces++; else line.approxPieces++;
    }
    if (th) {
      line.sheetKg = (line.sheetKg ?? 0) + (W * H) / 1e6 * th * STEEL_KG_PER_M2_MM;
      line.partsKg = (line.partsKg ?? 0) + (partsMm2 / 1e6) * th * STEEL_KG_PER_M2_MM;
    }
    map.set(code, line);
  }
  return [...map.values()]
    .map((l) => {
      if (l.sheetKg == null || l.partsKg == null) return l;
      const scrap = Math.max(0, l.sheetKg - l.partsKg);
      return { ...l, sheetKg: r1(l.sheetKg), partsKg: r1(l.partsKg), scrapKg: r1(scrap), scrapPct: l.sheetKg > 0 ? r1((scrap / l.sheetKg) * 100) : null };
    })
    .sort((a, b) => a.thicknessMm - b.thicknessMm || a.material.localeCompare(b.material) || a.widthMm * a.heightMm - b.widthMm * b.heightMm);
}

export type RequestUnit = "sheet" | "kg";

/** What goes into the Materials module for one line. `kg` orders by weight, scrap included (whole sheets). */
export function toMaterialPayload(l: MaterialRequestLine, unit: RequestUnit) {
  const estimate = l.approxPieces > 0;
  const bits = [
    `From nesting: ${l.sheets} sheet${l.sheets === 1 ? "" : "s"} of ${l.widthMm} × ${l.heightMm} mm`,
    l.sheetKg != null ? `${l.sheetKg} kg total = ${l.partsKg} kg parts + ${l.scrapKg} kg scrap (${l.scrapPct}%)` : null,
    estimate ? `ESTIMATE — ${l.approxPieces} of ${l.exactPieces + l.approxPieces} pieces are approximate shapes` : "all pieces exact",
  ].filter(Boolean);
  const qty = unit === "kg" && l.sheetKg != null ? l.sheetKg : l.sheets;
  return {
    code: l.code,
    description: l.description,
    spec: l.spec,
    unit: (unit === "kg" && l.sheetKg != null ? "kg" : "sheet") as RequestUnit,
    requiredQty: qty,
    notes: bits.join(". ").slice(0, 1000),
  };
}
