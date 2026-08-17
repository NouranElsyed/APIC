import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "primary" | "accent" | "warning" | "violet" | "slate";
  hint?: string;
}

const toneMap: Record<string, { bg: string; fg: string }> = {
  primary: { bg: "bg-primary/10", fg: "text-primary" },
  accent: { bg: "bg-accent/10", fg: "text-accent" },
  warning: { bg: "bg-warning/10", fg: "text-warning" },
  violet: { bg: "bg-[#7c3aed1a]", fg: "text-[#7c3aed]" },
  slate: { bg: "bg-slate-500/10", fg: "text-slate-600" },
};

export function KpiCard({ label, value, icon: Icon, tone = "primary", hint }: KpiCardProps) {
  const t = toneMap[tone];
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", t.bg)}>
          <Icon className={cn("h-5 w-5", t.fg)} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tracking-tight text-foreground">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
