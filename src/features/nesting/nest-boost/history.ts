// Undo / redo for hand edits of a nest (move, rotate, put back, add/delete/resize sheet...).
// A snapshot is taken every time the nest is idle (nothing picked up) and differs from the last one.
import type { OptResult, Sheet } from "./engine";

interface Snap {
  sig: string;
  sheets: Sheet[];
  un: OptResult["un"];
  manual: boolean | undefined;
}

export interface NestHistory {
  stack: Snap[];
  /** Index of the snapshot that matches the current nest. */
  i: number;
}

const MAX = 100;

/** Compact description of everything an undo has to bring back. */
export function signature(res: OptResult): string {
  const sheets = res.sheets.map(
    (sh) =>
      `${sh.th}|${sh.material}|${sh.W ?? ""}|${sh.H ?? ""}:` +
      sh.items.map((it) => `${it.g.id},${it.rot},${it.x},${it.y}`).join(";"),
  );
  return `${res.manual ? 1 : 0}#${res.un.length}#${sheets.join("/")}`;
}

const cloneSheets = (sheets: Sheet[]): Sheet[] => sheets.map((sh) => ({ ...sh, items: sh.items.map((it) => ({ ...it })) }));

const snap = (res: OptResult): Snap => ({ sig: signature(res), sheets: cloneSheets(res.sheets), un: [...res.un], manual: res.manual });

/** Fresh history whose only entry is the current state (call whenever a new nest result appears). */
export function resetHistory(res: OptResult | null): NestHistory {
  return res ? { stack: [snap(res)], i: 0 } : { stack: [], i: -1 };
}

/** Records the current state if it changed since the last snapshot (drops any redo entries). */
export function record(h: NestHistory, res: OptResult): boolean {
  if (h.i < 0) return false;
  if (signature(res) === h.stack[h.i].sig) return false;
  h.stack.length = h.i + 1;
  h.stack.push(snap(res));
  if (h.stack.length > MAX) h.stack.shift();
  h.i = h.stack.length - 1;
  return true;
}

export const canUndo = (h: NestHistory) => h.i > 0;
export const canRedo = (h: NestHistory) => h.i >= 0 && h.i < h.stack.length - 1;

function apply(h: NestHistory, res: OptResult, i: number): boolean {
  const s = h.stack[i];
  if (!s) return false;
  h.i = i;
  res.sheets = cloneSheets(s.sheets);
  res.un = [...s.un];
  res.manual = s.manual;
  return true;
}

export function undo(h: NestHistory, res: OptResult): boolean {
  return canUndo(h) && apply(h, res, h.i - 1);
}

export function redo(h: NestHistory, res: OptResult): boolean {
  return canRedo(h) && apply(h, res, h.i + 1);
}