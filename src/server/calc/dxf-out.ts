// Writes one part (outline + holes, mm) as a DXF that AutoCAD and other CAD programs open.
// R12 format (AC1009): POLYLINE/VERTEX/SEQEND and CIRCLE are understood by every version. The header MUST name the
// version — without $ACADVER the file is read as a very old release that does not know LWPOLYLINE, so the drawing
// opens empty. $EXTMIN/$EXTMAX let "zoom extents" show the part at once.

export type DxfPt = [number, number];

/** The circle a loop is made of (many points all at the same distance from the centre), else null. */
export function loopAsCircle(loop: DxfPt[]): { cx: number; cy: number; r: number } | null {
  if (loop.length < 12) return null;
  const xs = loop.map((p) => p[0]);
  const ys = loop.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const d = loop.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = d.reduce((a, b) => a + b, 0) / d.length;
  if (!(r > 0)) return null;
  return d.every((v) => Math.abs(v - r) <= r * 0.002) ? { cx, cy, r } : null;
}

export function loopsToDxf(outer: DxfPt[], holes: DxfPt[][]): string {
  const minX = Math.min(...outer.map((q) => q[0]));
  const minY = Math.min(...outer.map((q) => q[1]));
  const maxX = Math.max(...outer.map((q) => q[0]));
  const maxY = Math.max(...outer.map((q) => q[1]));
  const f = (n: number) => (+n.toFixed(4)).toString();
  let s = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n";
  s += `9\n$EXTMIN\n10\n0.0\n20\n0.0\n30\n0.0\n9\n$EXTMAX\n10\n${f(maxX - minX)}\n20\n${f(maxY - minY)}\n30\n0.0\n0\nENDSEC\n`;
  s += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0\n0\nENDTAB\n";
  s += "0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n";
  s += "0\nSECTION\n2\nENTITIES\n";
  for (const loop of [outer, ...holes]) {
    const c = loopAsCircle(loop);
    if (c) {
      s += `0\nCIRCLE\n8\n0\n10\n${f(c.cx - minX)}\n20\n${f(c.cy - minY)}\n30\n0.0\n40\n${f(c.r)}\n`;
      continue;
    }
    s += "0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n";
    for (const q of loop) s += `0\nVERTEX\n8\n0\n10\n${f(q[0] - minX)}\n20\n${f(q[1] - minY)}\n`;
    s += "0\nSEQEND\n8\n0\n";
  }
  return s + "0\nENDSEC\n0\nEOF\n";
}
