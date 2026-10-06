import { barStats, barTrims, type Bar, type Settings1D } from "../nest-boost-1d/engine";

/** Stable colour per part serial number (shared by the screen and the report image). */
export function pieceColor(sn: number): string {
  const hues = [210, 25, 150, 280, 50, 190, 340, 100];
  return `hsl(${hues[sn % hues.length]} 65% 62%)`;
}

/** Draws one bar (trims, cuts, reusable remnant) to a PNG data URL. Browser only. */
export function renderBarPng(b: Bar, S: Settings1D, width = 1200, height = 44): { dataUrl: string; width: number; height: number } | null {
  if (typeof document === "undefined") return null;
  const L = b.length ?? b.sourceLength;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const c = cv.getContext("2d");
  if (!c) return null;
  const k = width / L;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, width, height);
  const t = barTrims(b, S);
  c.fillStyle = "#e5e7eb";
  c.fillRect(0, 0, t.left * k, height);
  c.fillRect(width - t.right * k, 0, t.right * k, height);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "bold 13px system-ui, Arial, sans-serif";
  for (const cut of b.cuts) {
    const x = (t.left + cut.pos) * k;
    const w = cut.piece.length * k;
    c.fillStyle = pieceColor(cut.piece.sn);
    c.fillRect(x, 0, w, height);
    c.strokeStyle = "#fff";
    c.strokeRect(x, 0, w, height);
    if (w > 28) {
      c.fillStyle = "#fff";
      c.fillText(`#${cut.piece.sn}`, x + w / 2, height / 2);
    }
  }
  const st = barStats(b, S);
  if (st.isRemnant && st.rest > 0) {
    const x = (t.left + st.usedLength) * k;
    c.fillStyle = "rgba(16,185,129,.35)";
    c.fillRect(x, 0, st.rest * k, height);
    c.fillStyle = "#065f46";
    c.fillText("rest", x + (st.rest * k) / 2, height / 2);
  }
  c.strokeStyle = "#64748b";
  c.strokeRect(0.5, 0.5, width - 1, height - 1);
  return { dataUrl: cv.toDataURL("image/png"), width, height };
}
