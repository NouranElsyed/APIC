"use client";
import * as React from "react";
import type { ProjectOption } from "./types";

interface TakeoffProjectContextValue {
  projects: ProjectOption[];
  projectId: string;
  setProjectId: (id: string) => void;
  loadingProjects: boolean;
  /** Part ids the user sent from Standard Calculations, waiting to be imported by the DXF Nesting tab. */
  nestingQueue: string[];
  /** Same, for the 1D tool (non-plate parts: hot rolled, pipe, ...). */
  nestingQueue1D: string[];
  queueForNesting: (partIds: string[], kind?: "1D" | "2D") => void;
  clearNestingQueue: () => void;
  clearNestingQueue1D: () => void;
}

const TakeoffProjectContext = React.createContext<TakeoffProjectContextValue | null>(null);

/**
 * Holds the single "active project" for the whole Takeoff section
 * (Standard Calculations + DXF Nesting tabs) so it only has to be chosen
 * once and stays in sync when switching tabs. Intentionally does NOT
 * auto-select the first project — the user lands on the page with
 * nothing chosen and must pick a project explicitly.
 */
export function TakeoffProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [nestingQueue, setNestingQueue] = React.useState<string[]>([]);
  const [nestingQueue1D, setNestingQueue1D] = React.useState<string[]>([]);
  const queueForNesting = React.useCallback((ids: string[], kind: "1D" | "2D" = "2D") => {
    const set = kind === "1D" ? setNestingQueue1D : setNestingQueue;
    set((q) => Array.from(new Set([...q, ...ids])));
  }, []);
  const clearNestingQueue = React.useCallback(() => setNestingQueue([]), []);
  const clearNestingQueue1D = React.useCallback(() => setNestingQueue1D([]), []);

  React.useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data))
      .finally(() => setLoadingProjects(false));
  }, []);

  return (
    <TakeoffProjectContext.Provider value={{ projects, projectId, setProjectId, loadingProjects, nestingQueue, nestingQueue1D, queueForNesting, clearNestingQueue, clearNestingQueue1D }}>
      {children}
    </TakeoffProjectContext.Provider>
  );
}

export function useTakeoffProject() {
  const ctx = React.useContext(TakeoffProjectContext);
  if (!ctx) {
    throw new Error("useTakeoffProject must be used within a TakeoffProjectProvider");
  }
  return ctx;
}
