/**
 * Nozzle library: pad sizes and thicknesses, the DN600 manhole and the shared constants. Pipe and flange weights
 * live in catalogue-data.ts (Trouvay & Cauvin tables). Adding a pad size = adding one row to PAD_DIA.
 */

export type NozzleLocation = "shell" | "roof";

/** Steel density, kg per mm³ (7850 kg/m³). */
export const STEEL_KG_PER_MM3 = 7.85e-6;

/** Nozzles up to this size get no reinforcing pad. */
export const NO_PAD_MAX_DN = 50;

/** Reinforcing pad outside diameter (mm) per DN, separate for shell and roof. */
export const PAD_DIA: Record<NozzleLocation, Record<number, number>> = {
  shell: { 100: 305, 150: 400, 200: 485, 250: 585, 600: 1255 },
  roof: { 80: 265, 125: 300, 150: 400, 200: 485, 600: 950 },
};

/** Reinforcing pad thickness (mm). */
export const PAD_THK: Record<NozzleLocation, number> = { shell: 8, roof: 12 };

/** A pad for a DN that is not in PAD_DIA is estimated as this multiple of the pipe OD (rounded to 5 mm) and flagged. */
export const PAD_ESTIMATE_FACTOR = 2.2;

/**
 * DN600 manhole, API-650 style, as the workbook lists it: the neck is pipe, the flange ring and the cover are cut
 * from plate and are listed in the tank's component inventory ("Manhole flange", "Manhole cover"), NOT in the
 * nozzle schedule weight.
 */
export const MANHOLE = {
  dn: 600,
  /** Flange ring: centre-line diameter (the workbook's length is π × 0.81 m), width and thickness, mm. */
  ring: { meanDia: 810, width: 100, thk: 10 },
  /** Cover: disc diameter and thickness, mm. */
  cover: { dia: 810, thk: 10 },
} as const;
