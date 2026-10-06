"use client";
import * as React from "react";
import type { HistoryEntry, ProjectOption } from "./types";

interface TakeoffProjectContextValue {
  projects: ProjectOption[];
  /** The selected project ("" = none). Selecting a project closes the open history entry. */
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

  /** The signed-in user's nesting history, newest first. */
  history: HistoryEntry[];
  /** The history entry being worked on ("" = none). */
  historyId: string;
  /**
   * Where the Nesting tabs auto-save: the project id, or `h:<historyId>` for a history entry,
   * or "" when nothing is open yet.
   */
  workspaceId: string;
  /** Display name of whatever `workspaceId` points to. */
  workspaceLabel: string;
  /**
   * Returns the id of the open workspace; when neither a project nor a history entry is open it
   * first starts a new history entry (named from `hint` + the date) and opens it. Used by the DXF /
   * CSV imports so work started without a project is never lost — and never clutters the project list.
   */
  ensureWorkspace: (hint?: string) => Promise<string>;
  /** True (once per tool) for a workspace that was just created, so its empty content isn't fetched. */
  consumeFresh: (workspaceId: string, kind: string) => boolean;

  /** Re-reads the history list from the server (e.g. when the History window opens). */
  refreshHistory: () => Promise<void>;
  openHistory: (id: string) => void;
  /** Closes the current project / history entry and empties the Nesting tabs, ready for a new import. */
  startNewImport: () => void;
  renameHistory: (id: string, name: string) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  /** Saves a history entry as a project with the given name, then opens that project. */
  saveHistoryAsProject: (id: string, name: string) => Promise<ProjectOption>;

  /** Creates an empty project with the given name and opens it. */
  createProject: (name: string) => Promise<ProjectOption>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  /** Auto-save writers register here so "Save as project" can flush pending changes first. */
  registerFlusher: (fn: () => Promise<void>) => () => void;
}

const TakeoffProjectContext = React.createContext<TakeoffProjectContextValue | null>(null);

async function api<T>(url: string, init?: RequestInit, errors: Record<number, string> = {}): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const fallback = res.status === 403 ? "You are not allowed to do that" : res.status === 404 ? "Not found — it may have been deleted" : "Something went wrong, please try again";
    throw new Error(errors[res.status] ?? fallback);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function localStamp() {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * Holds the single "active workspace" for the whole Takeoff section (Standard Calculations + DXF
 * Nesting tabs): either a project or an entry of the user's nesting history. Intentionally does NOT
 * auto-select anything — the user lands on the page with nothing chosen.
 */
export function TakeoffProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [projectId, setProjectIdState] = React.useState("");
  const [historyId, setHistoryIdState] = React.useState("");
  const projectIdRef = React.useRef("");
  const historyIdRef = React.useRef("");
  const select = React.useCallback((p: string, h: string) => {
    projectIdRef.current = p;
    historyIdRef.current = h;
    setProjectIdState(p);
    setHistoryIdState(h);
  }, []);
  const setProjectId = React.useCallback((id: string) => select(id, ""), [select]);
  const openHistory = React.useCallback((id: string) => select("", id), [select]);
  const startNewImport = React.useCallback(() => select("", ""), [select]);

  const pendingWorkspace = React.useRef<Promise<string> | null>(null);
  const freshRef = React.useRef<Set<string>>(new Set());
  const flushers = React.useRef<Set<() => Promise<void>>>(new Set());
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [nestingQueue, setNestingQueue] = React.useState<string[]>([]);
  const [nestingQueue1D, setNestingQueue1D] = React.useState<string[]>([]);
  const queueForNesting = React.useCallback((ids: string[], kind: "1D" | "2D" = "2D") => {
    const set = kind === "1D" ? setNestingQueue1D : setNestingQueue;
    set((q) => Array.from(new Set([...q, ...ids])));
  }, []);
  const clearNestingQueue = React.useCallback(() => setNestingQueue([]), []);
  const clearNestingQueue1D = React.useCallback(() => setNestingQueue1D([]), []);

  const workspaceOf = (p: string, h: string) => (p ? p : h ? `h:${h}` : "");
  const workspaceId = workspaceOf(projectId, historyId);
  const workspaceLabel = projectId
    ? projects.find((p) => p.id === projectId)?.name ?? ""
    : historyId
      ? history.find((h) => h.id === historyId)?.name ?? ""
      : "";

  const ensureWorkspace = React.useCallback(
    async (hint?: string) => {
      const open = workspaceOf(projectIdRef.current, historyIdRef.current);
      if (open) return open;
      if (pendingWorkspace.current) return pendingWorkspace.current; // two imports at once -> one entry
      const job = (async () => {
        const entry = await api<HistoryEntry>("/api/nesting/history", json("POST", { stamp: localStamp(), hint }), {
          403: "You are not allowed to save imports",
        });
        freshRef.current.add(`h:${entry.id}:2D`);
        freshRef.current.add(`h:${entry.id}:1D`);
        setHistory((prev) => [entry, ...prev]);
        select("", entry.id);
        return `h:${entry.id}`;
      })().finally(() => {
        pendingWorkspace.current = null;
      });
      pendingWorkspace.current = job;
      return job;
    },
    [select],
  );

  const consumeFresh = React.useCallback((id: string, kind: string) => freshRef.current.delete(`${id}:${kind}`), []);

  const refreshHistory = React.useCallback(async () => {
    try {
      const data = await api<HistoryEntry[]>("/api/nesting/history");
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      /* keep the list we have */
    }
  }, []);

  const renameHistory = React.useCallback(async (id: string, name: string) => {
    const r = await api<{ name: string }>(`/api/nesting/history/${id}`, json("PATCH", { name }));
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, name: r.name } : h)));
  }, []);

  const deleteHistory = React.useCallback(
    async (id: string) => {
      await api(`/api/nesting/history/${id}`, { method: "DELETE" });
      setHistory((prev) => prev.filter((h) => h.id !== id));
      if (historyIdRef.current === id) select("", ""); // the Nesting tabs empty themselves
    },
    [select],
  );

  const saveHistoryAsProject = React.useCallback(
    async (id: string, name: string) => {
      // make sure the latest changes of the open entry are on the server before they are copied
      if (historyIdRef.current === id) await Promise.all([...flushers.current].map((f) => f().catch(() => undefined)));
      const proj = await api<ProjectOption>(`/api/nesting/history/${id}/save-as-project`, json("POST", { name, stamp: localStamp() }), {
        403: "You are not allowed to create projects",
      });
      setProjects((prev) => [{ id: proj.id, name: proj.name, number: proj.number }, ...prev]);
      setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, savedProjectId: proj.id } : h)));
      select(proj.id, ""); // continue working in the project
      return proj;
    },
    [select],
  );

  const createProject = React.useCallback(
    async (name: string) => {
      const proj = await api<ProjectOption>("/api/nesting/auto-project", json("POST", { name, stamp: localStamp() }), {
        403: "You are not allowed to create projects",
      });
      setProjects((prev) => [{ id: proj.id, name: proj.name, number: proj.number }, ...prev]);
      select(proj.id, ""); // opens empty: its (missing) workspace clears the Nesting tabs
      return proj;
    },
    [select],
  );

  const renameProject = React.useCallback(async (id: string, name: string) => {
    const r = await api<{ name: string }>(`/api/projects/${id}`, json("PATCH", { name }), { 403: "You are not allowed to rename projects" });
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: r.name } : p)));
  }, []);

  const deleteProject = React.useCallback(
    async (id: string) => {
      await api(`/api/projects/${id}`, { method: "DELETE" }, { 403: "Only an administrator can delete a project" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setHistory((prev) => prev.map((h) => (h.savedProjectId === id ? { ...h, savedProjectId: null } : h)));
      if (projectIdRef.current === id) select("", "");
    },
    [select],
  );

  const registerFlusher = React.useCallback((fn: () => Promise<void>) => {
    flushers.current.add(fn);
    return () => {
      flushers.current.delete(fn);
    };
  }, []);

  React.useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data))
      .finally(() => setLoadingProjects(false));
    fetch("/api/nesting/history")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => undefined);
  }, []);

  return (
    <TakeoffProjectContext.Provider
      value={{
        projects, projectId, setProjectId, loadingProjects, nestingQueue, nestingQueue1D, queueForNesting, clearNestingQueue, clearNestingQueue1D,
        history, historyId, workspaceId, workspaceLabel, ensureWorkspace, consumeFresh,
        refreshHistory, openHistory, startNewImport, renameHistory, deleteHistory, saveHistoryAsProject,
        createProject, renameProject, deleteProject, registerFlusher,
      }}
    >
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
