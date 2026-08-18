export type ProjectStage = "TENDERING" | "EXECUTION";

export type ProjectStatus =
  | "UNDER_STUDY"
  | "SUBMITTED"
  | "APOLOGIZED"
  | "CANCELLED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "ARCHIVED";

export interface ProjectRow {
  id: string;
  number: string;
  name: string;
  description: string | null;
  stage: ProjectStage;
  status: ProjectStatus;
  revision: string;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  customer: { id: string; name: string; code: string; contact: string | null; email: string | null; phone: string | null };
  createdBy: { name: string };
  _count?: { documents: number };
}

export interface CustomerOption {
  id: string;
  name: string;
  code: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
}
