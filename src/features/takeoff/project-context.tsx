"use client";
import * as React from "react";
import type { ProjectOption } from "./types";

interface TakeoffProjectContextValue {
  projects: ProjectOption[];
  projectId: string;
  setProjectId: (id: string) => void;
  loadingProjects: boolean;
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

  React.useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data))
      .finally(() => setLoadingProjects(false));
  }, []);

  return (
    <TakeoffProjectContext.Provider value={{ projects, projectId, setProjectId, loadingProjects }}>
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
