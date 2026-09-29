import type { TakeoffPartRow } from "@/features/takeoff/types";

/**
 * Which nesting tool a Standard Calculations part belongs to.
 *   PLATE                       -> 2D (sheet nesting, needs a DXF)
 *   HOT_ROLLED / PIPE (anything else linear) -> 1D (cut from stock bars)
 */
export type NestKind = "1D" | "2D";

export function nestKindOf(partType: string): NestKind {
  return partType === "PLATE" ? "2D" : "1D";
}

export interface Piece1DInput {
  name: string;
  profile: string;
  material: string;
  /** Cut length in mm. */
  length: number;
  qty: number;
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Trims float noise: 0.1+0.2 m -> 300 mm, not 300.00000000000006. */
const mm = (metres: number) => Math.round(metres * 1000 * 100) / 100;

const fmt = (x: number) => String(Math.round(x * 100) / 100);

/**
 * Converts a non-plate takeoff part into a 1D piece (geometry lengths are
 * stored in metres in Standard Calculations, the 1D tool works in mm).
 * Returns { error } when the part cannot be cut from a bar.
 */
export function partTo1DPiece(part: TakeoffPartRow): { piece: Piece1DInput } | { error: string } {
  if (part.qty <= 0) return { error: "qty is 0" };
  const g = (part.geometry ?? {}) as Record<string, unknown>;
  const material = part.material ?? "";

  switch (part.partType) {
    case "HOT_ROLLED": {
      const length = mm(num(g.length));
      const profile = String(g.profile ?? "").trim();
      if (length <= 0) return { error: "no length" };
      return { piece: { name: part.description, profile, material, length, qty: part.qty } };
    }
    case "PIPE": {
      const length = mm(num(g.length));
      const od = mm(num(g.od));
      if (length <= 0) return { error: "no length" };
      const thk = part.thicknessMm ? `x${fmt(part.thicknessMm)}` : "";
      const profile = od > 0 ? `PIPE OD${fmt(od)}${thk}` : "PIPE";
      return { piece: { name: part.description, profile, material, length, qty: part.qty } };
    }
    default:
      return { error: `${part.partType} has no bar length` };
  }
}

/** True when the part can be sent to the given tool. */
export function isNestable(part: TakeoffPartRow): boolean {
  if (part.qty <= 0) return false;
  if (part.partType === "PLATE") return !!part.dxf?.valid;
  return !("error" in partTo1DPiece(part));
}
