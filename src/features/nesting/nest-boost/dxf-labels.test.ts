import { describe, expect, it } from "vitest";
import { addFileParts, parseDXF } from "./engine";

const pair = (c: number, v: string | number) => `${c}\n${v}\n`;
const line = (x0: number, y0: number, x1: number, y1: number) =>
  pair(0, "LINE") + pair(8, "0") + pair(10, x0) + pair(20, y0) + pair(11, x1) + pair(21, y1);
const rect = (x: number, y: number, w: number, h: number) =>
  line(x, y, x + w, y) + line(x + w, y, x + w, y + h) + line(x + w, y + h, x, y + h) + line(x, y + h, x, y);
const mtext = (x: number, y: number, t: string) => pair(0, "MTEXT") + pair(8, "0") + pair(10, x) + pair(20, y) + pair(40, 25) + pair(1, t);
const text = (x: number, y: number, t: string) => pair(0, "TEXT") + pair(8, "0") + pair(10, x) + pair(20, y) + pair(40, 25) + pair(1, t);
const dxf = (body: string) => pair(0, "SECTION") + pair(2, "ENTITIES") + body + pair(0, "ENDSEC") + pair(0, "EOF");
const counters = () => ({ id: 1, sn: 0 });

describe("QTY / thk notes in the DXF", () => {
  it("reads quantity and thickness from a note written above each group of parts", () => {
    const body =
      mtext(500, 600, "QTY: 1\\Pthk: 14") + rect(0, 0, 400, 100) + rect(600, 0, 400, 100) +
      mtext(3000, 600, "{\\fArial|b0;QTY: 3}\\Pthk: 8") + rect(2800, 0, 300, 200);
    const r = parseDXF(dxf(body));
    expect(r.labels).toEqual([{ x: 500, y: 600, qty: 1, th: 14 }, { x: 3000, y: 600, qty: 3, th: 8 }]);
    const out = addFileParts([], r.loops, "2d.dxf", 1, counters(), { labels: r.labels });
    expect(out.labelled).toBe(3);
    // the two identical 400x100 rectangles are one row; the other group has its own thickness and quantity
    const rows = out.groups.map((g) => [g.th, g.qty, Math.round(g.w), Math.round(g.h)]).sort((a, b) => b[0] - a[0]);
    expect(rows).toEqual([[14, 2, 400, 100], [8, 3, 300, 200]]);
  });

  it("identical parts with different thickness stay separate rows (the two ellipses case)", () => {
    const body =
      mtext(200, 500, "QTY: 1\\Pthk: 8") + rect(0, 0, 400, 100) +
      mtext(2200, 500, "QTY: 1\\Pthk: 12") + rect(2000, 0, 400, 100);
    const r = parseDXF(dxf(body));
    const out = addFileParts([], r.loops, "2d.dxf", 1, counters(), { labels: r.labels });
    expect(out.groups.map((g) => [g.th, g.qty]).sort((a, b) => a[0] - b[0])).toEqual([[8, 1], [12, 1]]);
  });

  it("accepts the quantity and thickness as two separate TEXT entities, and falls back to the file name without notes", () => {
    const body = text(500, 620, "QTY: 2") + text(500, 580, "thk: 10") + rect(0, 0, 400, 100);
    const r = parseDXF(dxf(body));
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0]).toMatchObject({ qty: 2, th: 10 });
    const withLabel = addFileParts([], r.loops, "a.dxf", 1, counters(), { labels: r.labels });
    expect(withLabel.groups[0]).toMatchObject({ th: 10, qty: 2 });
    const plain = parseDXF(dxf(rect(0, 0, 400, 100)));
    expect(plain.labels).toEqual([]);
    expect(addFileParts([], plain.loops, "PL5mm.dxf", 1, counters(), { labels: plain.labels }).groups[0]).toMatchObject({ th: 5, qty: 1 });
  });
});