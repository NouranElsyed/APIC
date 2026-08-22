// Generates a real, CAD-openable ASCII DXF for one NestingSheet result
// (PROJECT.md §25-§32). Deliberately minimal — just enough DXF structure
// (HEADER with $INSUNITS=mm, plain ENTITIES section) for AutoCAD /
// DraftSight / SolidWorks to open it and see correct millimeter geometry.
//
// Layers (PROJECT.md §27): SHEET, MARGIN, PARTS, HOLES, LABELS.
//   - SHEET:  the full physical source sheet boundary (never shrunk).
//   - MARGIN: the usable nesting boundary inside the sheet.
//   - PARTS:  each placed part's outer contour, already transformed by
//             the SAME rotation/translation the engine used to place it
//             (see transformGeometryForPlacement in nesting-geometry.ts —
//             no new coordinates are computed here, PROJECT.md §28).
//   - HOLES:  each placed part's internal contours, transformed the same way.
//   - LABELS: a TEXT entity per placement with part number + instance
//             number, non-cutting geometry only.
//
// Coordinates are real millimeters, Z = 0, never scaled (PROJECT.md §32).

import type { Point } from "./dxf";
import { transformGeometryForPlacement, type RotationDeg } from "./nesting-geometry";

export interface DxfPlacementInput {
  takeoffPartId: string;
  itemNo: number;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  outer: Point[];
  holes: Point[][];
}

export interface DxfSheetInput {
  runId: string;
  sheetNumber: number;
  widthMm: number;
  lengthMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  placements: DxfPlacementInput[];
}

function isSupportedRotation(deg: number): deg is RotationDeg {
  return deg === 0 || deg === 90 || deg === 180 || deg === 270;
}

function lwpolyline(points: Point[], layer: string, closed = true): string {
  const flagValue = closed ? 1 : 0;
  const lines: string[] = ["0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", String(flagValue)];
  for (const p of points) {
    lines.push("10", formatNum(p.x), "20", formatNum(p.y));
  }
  return lines.join("\n");
}

function textEntity(x: number, y: number, height: number, value: string, layer: string): string {
  return ["0", "TEXT", "8", layer, "10", formatNum(x), "20", formatNum(y), "40", formatNum(height), "1", value].join(
    "\n",
  );
}

function formatNum(n: number): string {
  // Plenty of precision for mm-scale CAD/CNC geometry, trimmed of noise.
  return (Math.round(n * 1e6) / 1e6).toString();
}

// Renders one NestingSheet as a complete, standalone ASCII DXF document.
export function writeNestingSheetDxf(sheet: DxfSheetInput): string {
  const entities: string[] = [];

  // SHEET layer — full physical sheet boundary (PROJECT.md §26): always
  // the real widthMm × lengthMm, never the shrunk usable area.
  entities.push(
    lwpolyline(
      [
        { x: 0, y: 0 },
        { x: sheet.widthMm, y: 0 },
        { x: sheet.widthMm, y: sheet.lengthMm },
        { x: 0, y: sheet.lengthMm },
      ],
      "SHEET",
    ),
  );

  // MARGIN layer — usable nesting boundary inside the sheet (PROJECT.md §27).
  const usableMinX = sheet.marginLeftMm;
  const usableMinY = sheet.marginBottomMm;
  const usableMaxX = sheet.widthMm - sheet.marginRightMm;
  const usableMaxY = sheet.lengthMm - sheet.marginTopMm;
  if (usableMaxX > usableMinX && usableMaxY > usableMinY) {
    entities.push(
      lwpolyline(
        [
          { x: usableMinX, y: usableMinY },
          { x: usableMaxX, y: usableMinY },
          { x: usableMaxX, y: usableMaxY },
          { x: usableMinX, y: usableMaxY },
        ],
        "MARGIN",
      ),
    );
  }

  // PARTS / HOLES / LABELS — one entity set per NestingPlacement, using
  // the exact stored x/y/rotation (PROJECT.md §28-§30). Never recomputed.
  for (const placement of sheet.placements) {
    const rotation = isSupportedRotation(placement.rotationDeg) ? placement.rotationDeg : 0;
    const transformed = transformGeometryForPlacement(placement.outer, placement.holes, rotation, placement.xMm, placement.yMm);

    entities.push(lwpolyline(transformed.outer, "PARTS"));
    for (const hole of transformed.holes) {
      entities.push(lwpolyline(hole, "HOLES"));
    }

    // Label placed at the part's own bounding-box center — non-cutting.
    const xs = transformed.outer.map((p) => p.x);
    const ys = transformed.outer.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const height = Math.max(2, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.08);
    entities.push(textEntity(cx, cy, height, `PART-${placement.itemNo}`, "LABELS"));
    entities.push(textEntity(cx, cy - height * 1.3, height, `INSTANCE-${placement.instanceNumber}`, "LABELS"));
  }

  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4", // 4 = millimeters
    "0",
    "ENDSEC",
  ].join("\n");

  const tables = [
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    "5",
    ...["SHEET", "MARGIN", "PARTS", "HOLES", "LABELS"].flatMap((name) => [
      "0",
      "LAYER",
      "2",
      name,
      "70",
      "0",
      "62",
      "7",
      "6",
      "CONTINUOUS",
    ]),
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
  ].join("\n");

  const entitiesSection = ["0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC"].join("\n");

  const eof = ["0", "EOF"].join("\n");

  return [header, tables, entitiesSection, eof].join("\n") + "\n";
}

export function nestingSheetDxfFileName(runId: string, sheetNumber: number): string {
  const padded = String(sheetNumber).padStart(2, "0");
  return `Nesting_Run_${runId}_Sheet_${padded}.dxf`;
}
