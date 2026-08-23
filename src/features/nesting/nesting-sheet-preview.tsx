"use client";
import * as React from "react";
import type { NestingSheetRow, Point } from "./types";
import { transformGeometryForPlacement, type RotationDeg } from "@/server/calc/nesting-geometry";

export interface PartBBoxInfo {
  itemNo: number;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
}

export interface PartGeometryInfo {
  outer: Point[];
  holes: Point[][];
}

function isSupportedRotation(deg: number): deg is RotationDeg {
  return deg === 0 || deg === 90 || deg === 180 || deg === 270;
}

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
}

// True-shape 2D visualization of one nested sheet (PROJECT.md §18). Renders
// the sheet boundary and every placed part using its ACTUAL transformed
// outer/hole polygon geometry — the same transformGeometryForPlacement
// used by the DXF exporter (nesting-dxf-writer.ts) — so what the user sees
// here is exactly what gets cut, never a synthetic rectangle. Falls back to
// a bounding-box rectangle (visually flagged amber) only if geometry for a
// part is unexpectedly missing.
//
// SVG's y-axis grows downward, but stored placements are bottom-left
// origin with y growing upward, so the whole sheet group is flipped
// vertically once rather than negating every individual coordinate.
export function NestingSheetPreview({
  sheet,
  partInfoById,
  partGeometryById,
}: {
  sheet: NestingSheetRow;
  partInfoById: Map<string, PartBBoxInfo>;
  partGeometryById: Map<string, PartGeometryInfo>;
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
          const geo = partGeometryById.get(p.takeoffPartId);
          const rotation = isSupportedRotation(p.rotationDeg) ? p.rotationDeg : 0;

          if (geo) {
            const transformed = transformGeometryForPlacement(geo.outer, geo.holes, rotation, p.xMm, p.yMm);
            const xs = transformed.outer.map((pt) => pt.x);
            const ys = transformed.outer.map((pt) => pt.y);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            const labelSize = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.22;

            return (
              <g key={p.id}>
                <path
                  d={pointsToPath(transformed.outer)}
                  fill="#2563eb"
                  fillOpacity={0.18}
                  fillRule="evenodd"
                  stroke="#2563eb"
                  strokeWidth={strokeW}
                >
                  <title>{`Item #${info?.itemNo ?? "?"} — rotation ${p.rotationDeg}°`}</title>
                </path>
                {transformed.holes.map((hole, i) => (
                  <path
                    key={i}
                    d={pointsToPath(hole)}
                    fill="#f8fafc"
                    stroke="#2563eb"
                    strokeWidth={strokeW * 0.6}
                  />
                ))}
                <text
                  x={cx}
                  y={cy}
                  fontSize={Math.max(labelSize, 2)}
                  textAnchor="middle"
                  fill="#1e3a8a"
                  transform={`scale(1,-1) translate(0, ${-2 * cy})`}
                >
                  #{info?.itemNo ?? "?"}
                </text>
              </g>
            );
          }

          // Fallback: geometry missing for this part — flag it clearly as
          // an approximation rather than silently rendering as if it were
          // the real shape (PROJECT.md §18: never claim a bbox is the
          // actual cut geometry).
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
                  fill="#f59e0b"
                  fillOpacity={0.18}
                  stroke="#f59e0b"
                  strokeDasharray={`${strokeW * 3} ${strokeW * 2}`}
                  strokeWidth={strokeW}
                >
                  <title>{`Item #${info?.itemNo ?? "?"} — rotation ${p.rotationDeg}° (geometry unavailable, showing bounding box)`}</title>
                </rect>
              ) : (
                <circle cx={p.xMm} cy={p.yMm} r={strokeW * 6} fill="#f59e0b" stroke="#f59e0b" strokeWidth={strokeW}>
                  <title>{`Part ${p.takeoffPartId} — rotation ${p.rotationDeg}° (geometry unavailable)`}</title>
                </circle>
              )}
              {w != null && h != null && (
                <text
                  x={p.xMm + w / 2}
                  y={p.yMm + h / 2}
                  fontSize={Math.min(w, h) * 0.35}
                  textAnchor="middle"
                  fill="#92400e"
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
