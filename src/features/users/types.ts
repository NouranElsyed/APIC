export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "ENGINEER" | "VIEWER";
  department: string | null;
  active: boolean;
  createdAt: string;
}
