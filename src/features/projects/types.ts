export interface ProjectRow {
  id: string;
  number: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
  revision: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  customer: { id: string; name: string; code: string };
  createdBy: { name: string };
  _count?: { documents: number };
}

export interface CustomerOption {
  id: string;
  name: string;
  code: string;
}
