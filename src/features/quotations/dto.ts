import type { QStatus, QType, QuotationSummary } from "./quotation";

export interface QuotationRowDTO {
  id: string; number: string; revision: number; section: string | null; description: string;
  status: QStatus; currency: string; total: number; supply: number; install: number;
  issueDate: string; validUntil: string | null; itemCount: number; revisionCount: number;
}
export interface QuotationItemDTO { id: string; description: string; material: string | null; qty: number; unit: string; unitRate: number; type: QType; total: number }
export interface QuotationEventDTO { id: string; kind: string; message: string; at: string; by: string | null; quotationNumber?: string }
export interface QuotationDetailDTO extends QuotationRowDTO {
  profitMargin: number | null; preparedBy: string | null; approvedBy: string | null; decidedAt: string | null;
  terms: string | null; notes: string | null; grand: number; editable: boolean;
  items: QuotationItemDTO[]; events: QuotationEventDTO[];
  revisions: { id: string; revision: number; status: QStatus; total: number; issueDate: string }[];
  project: { id: string; number: string; name: string; customer: string };
}
export interface QuotationsData {
  today: string;
  rows: QuotationRowDTO[];
  summary: QuotationSummary;
  trend: { key: string; label: string; value: number }[];
  events: QuotationEventDTO[];
}
