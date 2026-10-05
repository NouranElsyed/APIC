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
  /**
   * Returns the active project id; when none is selected, first creates a new project named
   * "<user> — <date time>", selects it and returns its id. Used by the DXF / CSV imports of the
   * Nesting tabs so work started without a project is never lost.
   */
  ensureProject: () => Promise<string>;
  /** True (once per tool) for a project that was just auto-created, so its empty workspace isn't fetched. */
  consumeFresh: (projectId: string, kind: string) => boolean;
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
  const [projectId, setProjectIdState] = React.useState("");
  const projectIdRef = React.useRef("");
  const setProjectId = React.useCallback((id: string) => {
    projectIdRef.current = id;
    setProjectIdState(id);
  }, []);
  const pendingProject = React.useRef<Promise<string> | null>(null);
  const freshRef = React.useRef<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [nestingQueue, setNestingQueue] = React.useState<string[]>([]);
  const [nestingQueue1D, setNestingQueue1D] = React.useState<string[]>([]);
  const queueForNesting = React.useCallback((ids: string[], kind: "1D" | "2D" = "2D") => {
    const set = kind === "1D" ? setNestingQueue1D : setNestingQueue;
    set((q) => Array.from(new Set([...q, ...ids])));
  }, []);
  const clearNestingQueue = React.useCallback(() => setNestingQueue([]), []);
  const clearNestingQueue1D = React.useCallback(() => setNestingQueue1D([]), []);

  const ensureProject = React.useCallback(async () => {
    if (projectIdRef.current) return projectIdRef.current;
    if (pendingProject.current) return pendingProject.current; // two imports at once -> one project
    const job = (async () => {
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      const res = await fetch("/api/nesting/auto-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stamp }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? "You are not allowed to create projects" : "Could not create the project");
      const proj: ProjectOption = await res.json();
      freshRef.current.add(`${proj.id}:2D`);
      freshRef.current.add(`${proj.id}:1D`);
      setProjects((prev) => [{ id: proj.id, name: proj.name, number: proj.number }, ...prev]);
      setProjectId(proj.id);
      return proj.id;
    })().finally(() => {
      pendingProject.current = null;
    });
    pendingProject.current = job;
    return job;
  }, [setProjectId]);

  const consumeFresh = React.useCallback((id: string, kind: string) => freshRef.current.delete(`${id}:${kind}`), []);

  React.useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data))
      .finally(() => setLoadingProjects(false));
  }, []);

  return (
    <TakeoffProjectContext.Provider value={{ projects, projectId, setProjectId, loadingProjects, nestingQueue, nestingQueue1D, queueForNesting, clearNestingQueue, clearNestingQueue1D, ensureProject, consumeFresh }}>
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
