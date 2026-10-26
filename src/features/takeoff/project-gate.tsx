"use client";
import * as React from "react";
import { FolderKanban, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTakeoffProject } from "./project-context";

/** Window event the Project bar listens to, so the empty page can open its "New project" window. */
export const NEW_PROJECT_EVENT = "takeoff:new-project";

/**
 * Every tab of Nesting & Costing (Standard Calculations, DXF / 1D Nesting, Nozzles, ... and later tanks, platforms,
 * ladders, handrails) belongs to ONE project. With no project (and no history entry) open, none of them shows its
 * content: the person is asked to choose a project or create a new one first.
 */
export function ProjectGate({ children }: { children: React.ReactNode }) {
  const { workspaceId, loadingProjects, projects, setProjectId } = useTakeoffProject();

  if (workspaceId) return <>{children}</>;

  if (loadingProjects) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-16 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FolderKanban className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">Select a project to start</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        All the tabs above work on one project. Choose an existing project, or create a new one — nothing is shown until a project is open.
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {projects.length > 0 && (
          <div className="w-72 text-left">
            <Select value="" onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button onClick={() => window.dispatchEvent(new Event(NEW_PROJECT_EVENT))}>
          <FolderPlus /> New project
        </Button>
      </div>
    </div>
  );
}
