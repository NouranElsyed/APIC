/** Steel density as kg per (mm² · m): a w×t mm flat bar weighs w × t × 0.00785 kg/m. */
const KG_PER_MM2_M = 0.00785;

/** Standard section weights (kg/m) for the common rolled profiles. */
const UPN: Record<number, number> = { 80: 8.64, 100: 10.6, 120: 13.4, 140: 16, 160: 18.8, 180: 22, 200: 25.3, 220: 29.4, 240: 33.2, 260: 37.9, 280: 41.8, 300: 46.2 };
const IPE: Record<number, number> = { 80: 6, 100: 8.1, 120: 10.4, 140: 12.9, 160: 15.8, 180: 18.8, 200: 22.4, 220: 26.2, 240: 30.7, 270: 36.1, 300: 42.2 };

const norm = (s: string) => s.toUpperCase().replace(/[\s_-]+/g, "").replace(/[×*]/g, "X");

/**
 * kg per metre of a profile name ("FB60x6", "UPN 300", "IPE200"), or null when unknown.
 * `overrides` (profile name -> kg/m) always wins, so any profile can be supplied by the caller.
 */
export function profileWeightPerMeter(profile: string, overrides?: Record<string, number>): number | null {
  const key = norm(profile || "");
  if (!key) return null;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) if (norm(k) === key && v > 0) return v;
  }
  const fb = /^(?:FB|FLATBAR|FLAT)(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/.exec(key);
  if (fb) return Number(fb[1]) * Number(fb[2]) * KG_PER_MM2_M;
  const sec = /^(UPN|IPE)(\d+)$/.exec(key);
  if (sec) return (sec[1] === "UPN" ? UPN : IPE)[Number(sec[2])] ?? null;
  return null;
}
