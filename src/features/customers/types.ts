export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
  createdAt: string;
  _count?: { projects: number };
}
