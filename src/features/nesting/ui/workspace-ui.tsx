"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Presentational building blocks shared by the 1D and 2D nesting workspaces (no nesting logic). */

export function WorkspaceHeader({
  icon, title, subtitle, actions,
}: { icon: React.ReactNode; title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type StepState = "done" | "current" | "todo";
export interface WorkflowStep { label: string; hint: string; state: StepState }

export function stepStates(done: boolean[]): StepState[] {
  const firstOpen = done.findIndex((d) => !d);
  return done.map((d, i) => (d ? "done" : i === firstOpen ? "current" : "todo"));
}

export function WorkflowStepper({ steps }: { steps: WorkflowStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm" aria-label="Workflow">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <li className="flex items-center gap-2.5" aria-current={s.state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                s.state === "done" && "bg-emerald-600 text-white",
                s.state === "current" && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                s.state === "todo" && "bg-muted text-muted-foreground",
              )}
            >
              {s.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className="leading-tight">
              <span className={cn("block text-sm font-semibold", s.state === "current" ? "text-primary" : "text-foreground")}>{s.label}</span>
              <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
            </span>
          </li>
          {i < steps.length - 1 && <span className="mx-1 hidden h-px min-w-6 flex-1 bg-border sm:block" aria-hidden="true" />}
        </React.Fragment>
      ))}
    </ol>
  );
}

export function Panel({
  title, meta, actions, children, className, bodyClassName,
}: {
  title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">
          {title}
          {meta && <span className="ml-2 text-xs font-normal text-muted-foreground">{meta}</span>}
        </h3>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </Card>
  );
}

export type KpiTone = "primary" | "success" | "warning" | "violet";
const KPI_TONE: Record<KpiTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600",
  warning: "bg-amber-500/10 text-amber-600",
  violet: "bg-violet-500/10 text-violet-600",
};

export function KpiTile({
  icon, label, value, hint, tone = "primary", progress,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: KpiTone; progress?: number }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", KPI_TONE[tone])}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight tracking-tight tabular-nums text-foreground">{value}</p>
        {progress !== undefined && (
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
        {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export interface PaneTab { id: string; label: React.ReactNode; content: React.ReactNode }

/** Tab strip whose panes all stay MOUNTED (inactive ones are only hidden). */
export function PaneTabs({
  tabs, value, onValueChange, className, listClassName, paneClassName,
}: { tabs: PaneTab[]; value: string; onValueChange: (id: string) => void; className?: string; listClassName?: string; paneClassName?: string }) {
  const baseId = React.useId();
  return (
    <div className={className}>
      <div role="tablist" className={cn("flex gap-1 border-b border-border", listClassName)}>
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id} type="button" role="tab" id={`${baseId}-tab-${t.id}`} aria-selected={active} aria-controls={`${baseId}-pane-${t.id}`}
              onClick={() => onValueChange(t.id)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${baseId}-pane-${t.id}`} aria-labelledby={`${baseId}-tab-${t.id}`} hidden={t.id !== value} className={paneClassName}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

export function EmptyPanel({
  icon, title, children, actions,
}: { icon: React.ReactNode; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && <p className="max-w-md text-xs text-muted-foreground">{children}</p>}
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
