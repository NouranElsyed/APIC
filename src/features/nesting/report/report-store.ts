import { useSyncExternalStore } from "react";
import type { Report1DInput } from "./report-1d";
import type { Report2DInput } from "./report-2d";

/**
 * Tiny page-level store so the 2D and 1D tools (separate components with their
 * own state) can each publish "give me my current result" for the combined
 * report button. Getters are called at click time, so the report always sees
 * the latest layout (including parts the user dragged around).
 */
type Get2D = () => Report2DInput | null;
type Get1D = () => Report1DInput | null;

let g2d: Get2D | null = null;
let g1d: Get1D | null = null;
let snapshot = 0; // bit 1 = 2D available, bit 2 = 1D available (a stable primitive for useSyncExternalStore)
const listeners = new Set<() => void>();

function update() {
  const next = (g2d ? 1 : 0) | (g1d ? 2 : 0);
  if (next !== snapshot) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

export function register2D(g: Get2D | null) {
  g2d = g;
  update();
}
export function register1D(g: Get1D | null) {
  g1d = g;
  update();
}
export function getReportInputs() {
  return { d2: g2d?.() ?? null, d1: g1d?.() ?? null };
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** { has2D, has1D } — re-renders when either tool gains/loses a result. */
export function useReportAvailability() {
  const v = useSyncExternalStore(subscribe, () => snapshot, () => 0);
  return { has2D: (v & 1) !== 0, has1D: (v & 2) !== 0 };
}
