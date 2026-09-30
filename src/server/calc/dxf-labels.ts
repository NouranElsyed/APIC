// Pairs the text written on a DXF sheet with the parts on it.
//
//   "5mm" / "PL10" / "t=8"        -> thickness, applies to a GROUP of parts
//   "x6" / "qty 6" / "6 pcs"      -> quantity, belongs to the NEAREST part
//   any other text inside a part  -> used as that part's description
//
// Everything here is a best guess from geometry; the importer shows the result
// in an editable table so the user always has the last word.

import type { DxfText, DxfPartGeometry } from "./dxf";

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export function boxOf(p: DxfPartGeometry): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of p.outer) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  return { minX, minY, maxX, maxY };
}

export interface TextMeaning { thicknessMm?: number; qty?: number }

const numOf = (s: string) => Number(s.replace(",", "."));

/** What a piece of text means (thickness and/or qty), if anything. */
export function classifyText(raw: string): TextMeaning {
  const s = raw.trim();
  const out: TextMeaning = {};

  const thk =
    /(?<![\d.,]|[x×]\s{0,3})(\d+(?:[.,]\d+)?)\s*(?:mm|ملي)(?![a-z])/i.exec(s) ??
    /(?:^|[^a-z])(?:pl|plate|thk|thick(?:ness)?|t)\s*[=:\-]?\s*(\d+(?:[.,]\d+)?)(?![\d.,]*[x×]\d)/i.exec(s);
  if (thk) {
    const v = numOf(thk[1]);
    if (v > 0 && v <= 200) out.thicknessMm = v;
  }

  const dimensionLike = out.thicknessMm === undefined && /\d\s*[x×]\s*\d/.test(s);
  const qty =
    /(?:^|[^a-z])(?:qty|quantity|q|nos?|عدد)\.?\s*[=:\-]?\s*(\d+)(?![\d.])/i.exec(s) ??
    /(\d+)\s*(?:pcs|pc|pieces|nos|no|off|ea)(?![a-z])/i.exec(s) ??
    (dimensionLike ? null : /(?:^|[\s(])[x×]\s*(\d+)(?![\d.,]*\s*(?:mm|[x×]))/i.exec(s)) ??
    (dimensionLike ? null : /(?:^|\s)(\d+)\s*[x×](?:\s|$)/i.exec(s));
  if (qty) {
    const v = Number(qty[1]);
    if (Number.isInteger(v) && v > 0 && v < 10000) out.qty = v;
  }
  return out;
}

function distPointToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(b.minX - px, 0, px - b.maxX);
  const dy = Math.max(b.minY - py, 0, py - b.maxY);
  return Math.hypot(dx, dy);
}

function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
  const dy = Math.max(a.minY - b.maxY, 0, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface PartLabels {
  thicknessMm?: number;
  qty?: number;
  /** Free text found inside the part (e.g. a part mark). */
  label?: string;
}

export function assignLabels(boxes: Box[], texts: DxfText[]): PartLabels[] {
  const res: PartLabels[] = boxes.map(() => ({}));
  if (boxes.length === 0 || texts.length === 0) return res;

  const meaning = texts.map((t) => classifyText(t.text));
  const idxQty = texts.map((_, i) => i).filter((i) => meaning[i].qty !== undefined);
  const headings = texts.map((_, i) => i).filter((i) => meaning[i].thicknessMm !== undefined && meaning[i].qty === undefined);
  const maxDim = (b: Box) => Math.max(b.maxX - b.minX, b.maxY - b.minY);

  // ---- quantity: nearest text per part, one text -> one part -----------------
  const pairs: { p: number; t: number; d: number }[] = [];
  for (let p = 0; p < boxes.length; p++) {
    for (const t of idxQty) {
      const d = distPointToBox(texts[t].x, texts[t].y, boxes[p]);
      const limit = 1.5 * Math.max(maxDim(boxes[p]), 5 * texts[t].height);
      if (d <= limit || (boxes.length === 1 && idxQty.length === 1)) pairs.push({ p, t, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const partDone = new Set<number>();
  const textDone = new Set<number>();
  for (const { p, t } of pairs) {
    if (partDone.has(p) || textDone.has(t)) continue;
    partDone.add(p); textDone.add(t);
    res[p].qty = meaning[t].qty;
    if (meaning[t].thicknessMm !== undefined) res[p].thicknessMm = meaning[t].thicknessMm; // "5mm x6" on the part itself
  }

  // ---- thickness: headings over groups ---------------------------------------
  if (headings.length === 1) {
    for (let p = 0; p < boxes.length; p++) res[p].thicknessMm ??= meaning[headings[0]].thicknessMm;
  } else if (headings.length > 1) {
    // (a) cluster parts that sit close together, give each cluster its nearest heading
    const nn = boxes.map((b, i) => Math.min(...boxes.map((c, j) => (i === j ? Infinity : gapBetween(b, c)))));
    const finiteNN = nn.filter(Number.isFinite);
    const T = Math.max(3 * median(finiteNN), 0.25 * median(boxes.map(maxDim)));
    const parent = boxes.map((_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (gapBetween(boxes[i], boxes[j]) <= T) parent[find(i)] = find(j);

    const clusters = new Map<number, number[]>();
    boxes.forEach((_, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), i]); });

    const chosen = new Map<number, number>(); // cluster root -> heading text idx
    for (const [root, members] of clusters) {
      const cb: Box = {
        minX: Math.min(...members.map((m) => boxes[m].minX)), minY: Math.min(...members.map((m) => boxes[m].minY)),
        maxX: Math.max(...members.map((m) => boxes[m].maxX)), maxY: Math.max(...members.map((m) => boxes[m].maxY)),
      };
      let best = -1, bestD = Infinity;
      for (const h of headings) {
        let d = distPointToBox(texts[h].x, texts[h].y, cb);
        if (texts[h].y < cb.minY) d *= 2; // headings are written above their group
        if (d < bestD) { bestD = d; best = h; }
      }
      chosen.set(root, best);
    }
    const claimed = new Set(chosen.values());
    const everyHeadingUsed = headings.every((h) => claimed.has(h));

    if (everyHeadingUsed) {
      for (const [root, members] of clusters)
        for (const m of members) res[m].thicknessMm ??= meaning[chosen.get(root)!].thicknessMm;
    } else {
      // (b) groups touch each other: use the layout rule instead — the heading
      // just above the part whose left edge is at/left of the part's centre.
      for (let p = 0; p < boxes.length; p++) {
        const b = boxes[p];
        const cx = (b.minX + b.maxX) / 2;
        let best = -1, bestScore = Infinity;
        for (const h of headings) {
          const x0 = texts[h].x - texts[h].width / 2;
          if (x0 > cx + 0.5 * maxDim(b)) continue;
          if (texts[h].y < b.minY) continue;
          const score = Math.max(texts[h].y - b.maxY, 0) + (cx - x0) * 1e-3;
          if (score < bestScore) { bestScore = score; best = h; }
        }
        if (best < 0) {
          let bd = Infinity;
          for (const h of headings) { const d = distPointToBox(texts[h].x, texts[h].y, b); if (d < bd) { bd = d; best = h; } }
        }
        res[p].thicknessMm ??= meaning[best].thicknessMm;
      }
    }
  }

  // ---- free text inside a part -> description --------------------------------
  texts.forEach((t, i) => {
    if (meaning[i].thicknessMm !== undefined || meaning[i].qty !== undefined) return;
    for (let p = 0; p < boxes.length; p++) {
      if (distPointToBox(t.x, t.y, boxes[p]) === 0) {
        res[p].label = res[p].label ? `${res[p].label} ${t.text}` : t.text;
        break;
      }
    }
  });
  return res;
}

/** One part as a stand-alone DXF (closed LWPOLYLINEs, mm, moved to 0,0). */
export function partToDxf(part: DxfPartGeometry): string {
  const b = boxOf(part);
  const loops = [part.outer, ...part.holes];
  const lines: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  for (const loop of loops) {
    lines.push(0, "LWPOLYLINE", 8, "0", 90, loop.length, 70, 1);
    for (const p of loop) lines.push(10, +(p.x - b.minX).toFixed(4), 20, +(p.y - b.minY).toFixed(4));
  }
  lines.push(0, "ENDSEC", 0, "EOF");
  return lines.join("\n") + "\n";
}
