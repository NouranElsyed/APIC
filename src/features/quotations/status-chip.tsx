import { CheckCircle2, CircleDot, Clock, FileEdit, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type QStatus } from "./quotation";

// Full class strings so Tailwind keeps them.
const STYLE: Record<QStatus, { chip: string; Icon: typeof Clock }> = {
  DRAFT: { chip: "bg-slate-100 text-slate-700", Icon: FileEdit },
  PENDING: { chip: "bg-blue-50 text-blue-700", Icon: CircleDot },
  UNDER_REVIEW: { chip: "bg-amber-50 text-amber-700", Icon: Clock },
  APPROVED: { chip: "bg-green-50 text-green-700", Icon: CheckCircle2 },
  REJECTED: { chip: "bg-red-50 text-red-700", Icon: XCircle },
};
export const STATUS_COLOR: Record<QStatus, string> = { DRAFT: "#94a3b8", PENDING: "#3b82f6", UNDER_REVIEW: "#f59e0b", APPROVED: "#16a34a", REJECTED: "#ef4444" };

export function StatusChip({ status, large }: { status: QStatus; large?: boolean }) {
  const { chip, Icon } = STYLE[status];
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold", large ? "text-sm" : "text-xs", chip)}><Icon className={large ? "h-4 w-4" : "h-3.5 w-3.5"} />{STATUS_LABEL[status]}</span>;
}
