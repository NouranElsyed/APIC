"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TakeoffProjectProvider, useTakeoffProject } from "./project-context";

function activeTabClass(isActive: boolean) {
  return isActive
    ? "border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground"
    : "px-1 pb-2 text-sm font-medium text-muted-foreground transition hover:text-foreground";
}

function TakeoffTopBar() {
  const pathname = usePathname();
  const isNesting = pathname?.startsWith("/takeoff/nesting") ?? false;
  const isScrap = pathname?.startsWith("/takeoff/scrap-material") ?? false;
  const isStandard = !isNesting && !isScrap;
  const { projects, projectId, setProjectId } = useTakeoffProject();

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border">
        <Link href="/takeoff" className={activeTabClass(isStandard)}>
          Standard Calculations
        </Link>
        <Link href="/takeoff/nesting" className={activeTabClass(isNesting)}>
          DXF Nesting
        </Link>
        <Link href="/takeoff/scrap-material" className={activeTabClass(isScrap)}>
          Scrap & Material
        </Link>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-72">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TakeoffShell({ children }: { children: React.ReactNode }) {
  return (
    <TakeoffProjectProvider>
      <div className="space-y-6">
        <TakeoffTopBar />
        {children}
      </div>
    </TakeoffProjectProvider>
  );
}
