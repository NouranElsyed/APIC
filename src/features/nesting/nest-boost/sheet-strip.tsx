"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { partColor, path, sheetStats, type Settings, type Sheet } from "./engine";

/** Small picture of a whole sheet with its parts (for the TruTops-style sheet strip). */
export function SheetThumb({ sheet, S, version, w = 200, h = 64 }: { sheet: Sheet; S: Settings; version: number; w?: number; h?: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const SW = sheet.W ?? S.W;
    const SH = sheet.H ?? S.H;
    const k = Math.min((w - 2) / SW, (h - 2) / SH) * dpr;
    const ox = (cv.width - SW * k) / 2;
    const oy = (cv.height + SH * k) / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.setTransform(k, 0, 0, -k, ox, oy);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, SW, SH);
    for (const it of sheet.items) {
      const P = path(it.g, it.rot, it.x, it.y);
      c.fillStyle = partColor(it.g);
      c.fill(P, "evenodd");
      c.lineWidth = 0.8 / k;
      c.strokeStyle = "rgba(0,0,0,0.45)";
      c.stroke(P);
    }
    c.lineWidth = 1 / k;
    c.strokeStyle = "rgba(100,116,139,0.9)";
    c.strokeRect(0, 0, SW, SH);
  }, [sheet, S, version, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

/**
 * TruTops-style sheet strip: one small card per sheet (picture, name, utilisation); click a card to open that
 * sheet below. The last tile adds a new empty sheet.
 */
export function SheetStrip({
  sheets, S, version, active, onSelect, onAdd, canAdd,
}: {
  sheets: Sheet[];
  S: Settings;
  version: number;
  active: number;
  onSelect?: (i: number) => void;
  /** Omit to hide the "New sheet" tile (read-only strips, e.g. in the saved nests list). */
  onAdd?: () => void;
  canAdd?: boolean;
}) {
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto rounded-lg border border-border bg-muted/30 p-2 [scrollbar-gutter:stable]">
      {sheets.map((sh, i) => {
        const st = sheetStats(sh, S);
        const on = i === active;
        return (
          <button
            key={i} type="button" onClick={() => onSelect?.(i)}
            title={`Sheet ${i + 1} — ${st.parts} parts, utilization ${st.utilization.toFixed(1)}%`}
            className={`flex w-[216px] shrink-0 flex-col gap-1 rounded-md border p-1.5 text-left text-xs transition-colors ${
              on ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card hover:bg-muted"
            }`}
          >
            <span className="flex items-center justify-between font-semibold">
              <span>Sheet {i + 1}</span>
              <span className="tabular-nums font-normal text-muted-foreground">{st.utilization.toFixed(1)}%</span>
            </span>
            <span className="flex justify-center rounded border border-border/60 bg-white">
              <SheetThumb sheet={sh} S={S} version={version} />
            </span>
            <span className="truncate text-muted-foreground">
              {sh.material ? `${sh.material} • ` : ""}{sh.th ? `${sh.th} mm • ` : ""}{Math.round(sh.W ?? S.W)} × {Math.round(sh.H ?? S.H)} • {st.parts} parts
            </span>
          </button>
        );
      })}
      {onAdd && (
      <button
        type="button" onClick={onAdd} disabled={!canAdd}
        className="flex w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card text-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title="Add an empty sheet"
      >
        <Plus className="h-4 w-4" /> New sheet
      </button>
      )}
    </div>
  );
}
