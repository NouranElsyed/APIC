/**
 * Nozzle library — every number here comes from the "Tanks Inventory" workbook (Weight Ref sheet and the nozzle
 * schedules of its 12 tank sheets). Adding a size = adding one row to the tables below.
 */

export type NozzleLocation = "shell" | "roof";

/** Steel density, kg per mm³ (7850 kg/m³). */
export const STEEL_KG_PER_MM3 = 7.85e-6;

/** ASME B36.10 STD pipe: outside diameter (mm) and mass (kg/m). */
export const PIPE_STD: Record<number, { od: number; kgPerM: number }> = {
  25: { od: 33.4, kgPerM: 2.5 },
  40: { od: 48.3, kgPerM: 3.63 },
  50: { od: 60.3, kgPerM: 5.44 },
  80: { od: 88.9, kgPerM: 11.29 },
  100: { od: 114.3, kgPerM: 16.07 },
  125: { od: 141.3, kgPerM: 21.77 },
  150: { od: 168.3, kgPerM: 28.26 },
  200: { od: 219.1, kgPerM: 42.55 },
  250: { od: 273.1, kgPerM: 60.3 },
  600: { od: 610, kgPerM: 141.12 },
};

/** Purchased WN RF flange, class 150 (kg). DN600 is not bought: the manhole flange is made from plate (see MANHOLE). */
export const FLANGE_WN_150_KG: Record<number, number> = {
  25: 1,
  40: 1.8,
  50: 2.3,
  80: 4,
  100: 5.5,
  125: 6.5,
  150: 9,
  200: 13,
  250: 18,
};

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
