// Internal / External area of a list of parts, in m².
//   INTERNAL part -> both faces count as internal  (face area x 2)
//   EXTERNAL part -> both faces count as external  (face area x 2)
//   BOTH          -> one face internal, one face external
// Face area = the part's total area (one face). A rolled section has no sheet area, so half of its paint area is used.

export interface SideAreaPart {
  side: "INTERNAL" | "EXTERNAL" | "BOTH";
  totalArea: number | null | undefined;
  paintAreaSqm?: number | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function sideAreas(parts: SideAreaPart[]): { internalSqm: number; externalSqm: number } {
  let internalSqm = 0;
  let externalSqm = 0;
  for (const p of parts) {
    const face = n(p.totalArea) > 0 ? n(p.totalArea) : n(p.paintAreaSqm) / 2;
    if (p.side === "BOTH") { internalSqm += face; externalSqm += face; }
    else if (p.side === "INTERNAL") internalSqm += face * 2;
    else externalSqm += face * 2;
  }
  return { internalSqm, externalSqm };
}
