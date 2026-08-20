import type { PartDxfInfo, PartType, PartSide } from "@/features/takeoff/types";

export type NestingJobStatus = "DRAFT" | "READY";

export interface NestingJobItemRow {
  id: string;
  qtyOverride: number | null;
  takeoffPart: {
    id: string;
    description: string;
    partType: PartType;
    side: PartSide;
    qty: number;
    thicknessMm: number | null;
    dxf: PartDxfInfo | null;
    drawing: { drawingNumber: string; title: string };
  };
}

export interface NestingJobRow {
  id: string;
  name: string;
  material: string | null;
  thicknessMm: number | null;
  status: NestingJobStatus;
  createdAt: string;
  items: NestingJobItemRow[];
}
