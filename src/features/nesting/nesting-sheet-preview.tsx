"use client";
import * as React from "react";
import type { NestingSheetRow } from "./types";

export interface PartBBoxInfo {
  itemNo: number;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
}

// Basic 2D visualization of one nested sheet (PROJECT.md §18). Renders the
// sheet boundary and every placed part as a rectangle at its real x/y
// origin and rotation, exactly as returned/persisted by the nesting engine
// — nothing here is randomized or faked. The part's un-rotated bounding
// box (already computed by the existing DXF parser, see
// EligiblePart.bboxWidthMm/bboxHeightMm) is swapped for 90°/270° rotations
// to get the on-sheet footprint; this is a bounding-box preview, not a
// true-shape CAD render, which is sufficient for Phase 2 (PROJECT.md §18).
//
// SVG's y-axis grows downward, but stored placements are bottom-left
// origin with y growing upward, so the whole sheet group is flipped
// vertically once rather than negating every individual coordinate.
export function NestingSheetPreview({
  sheet,
  partInfoById,
}: {
  sheet: NestingSheetRow;
  partInfoById: Map<string, PartBBoxInfo>;
}) {
  const padding = Math.max(sheet.widthMm, sheet.lengthMm) * 0.03;
  const viewW = sheet.widthMm + padding * 2;
  const viewH = sheet.lengthMm + padding * 2;
  const strokeW = Math.max(sheet.widthMm, sheet.lengthMm) * 0.003;

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className="w-full rounded-md border border-border bg-white"
      style={{ aspectRatio: `${viewW} / ${viewH}` }}
    >
      <g transform={`translate(${padding}, ${viewH - padding}) scale(1, -1)`}>
        <rect
          x={0}
          y={0}
          width={sheet.widthMm}
          height={sheet.lengthMm}
          fill="#f8fafc"
          stroke="#94a3b8"
          strokeWidth={strokeW}
        />
        {sheet.placements.map((p) => {
          const info = partInfoById.get(p.takeoffPartId);
          const rawW = info?.bboxWidthMm ?? null;
          const rawH = info?.bboxHeightMm ?? null;
          const swapped = p.rotationDeg === 90 || p.rotationDeg === 270;
          const w = rawW != null && rawH != null ? (swapped ? rawH : rawW) : null;
          const h = rawW != null && rawH != null ? (swapped ? rawW : rawH) : null;

          return (
            <g key={p.id}>
              {w != null && h != null ? (
                <rect
                  x={p.xMm}
                  y={p.yMm}
                  width={w}
                  height={h}
                  fill="#2563eb"
                  fillOpacity={0.18}
                  stroke="#2563eb"
                  strokeWidth={strokeW}
                >
                  <title>{`Item #${info?.itemNo ?? "?"} — rotation ${p.rotationDeg}°`}</title>
                </rect>
              ) : (
                <circle cx={p.xMm} cy={p.yMm} r={strokeW * 6} fill="#2563eb" stroke="#2563eb" strokeWidth={strokeW}>
                  <title>{`Part ${p.takeoffPartId} — rotation ${p.rotationDeg}°`}</title>
                </circle>
              )}
              {w != null && h != null && (
                <text
                  x={p.xMm + w / 2}
                  y={p.yMm + h / 2}
                  fontSize={Math.min(w, h) * 0.35}
                  textAnchor="middle"
                  fill="#1e3a8a"
                  transform={`scale(1,-1) translate(0, ${-2 * (p.yMm + h / 2)})`}
                >
                  #{info?.itemNo ?? "?"}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
