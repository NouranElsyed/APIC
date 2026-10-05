"use client";
import * as React from "react";
import { CheckCircle2, CloudOff, Loader2 } from "lucide-react";

export type AutosaveState = "idle" | "loading" | "saving" | "saved" | "error";

interface Options {
  kind: "2D" | "1D";
  projectId: string;
  /** True once if this project was just auto-created for the current import (nothing to load yet). */
  consumeFresh: (projectId: string, kind: string) => boolean;
  /** Reads the latest state to store. */
  capture: () => unknown;
  /** Puts a stored snapshot back; `null` = this project has none yet (start empty). */
  restore: (data: unknown | null) => void;
  /** Returns true while the user is mid-gesture (holding a part...) — the save waits. */
  busy?: () => boolean;
  /** Everything whose change should trigger a save (fixed length). */
  deps: React.DependencyList;
}

const DEBOUNCE_MS = 1500;

/**
 * Loads the workspace of the selected project and then auto-saves every change (debounced) to
 * /api/nesting/workspace, so work started with no project survives a refresh and can be reopened later.
 */
export function useNestingAutosave(opts: Options) {
  const { kind, projectId, deps } = opts;
  const latest = React.useRef(opts);
  React.useEffect(() => {
    latest.current = opts; // always the newest capture/restore closures, without re-running the effects below
  });

  const [state, setState] = React.useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const loadedFor = React.useRef(""); // project whose workspace has been loaded (saving is allowed only then)
  const dirty = React.useRef(false);
  const lastBody = React.useRef("");
  const prevProject = React.useRef("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = React.useCallback(async (pid: string, keepalive = false) => {
    if (!pid || loadedFor.current !== pid) return;
    const data = JSON.stringify(latest.current.capture());
    if (data === lastBody.current) { dirty.current = false; return; }
    const body = `{"projectId":${JSON.stringify(pid)},"kind":"${kind}","data":${data}}`;
    setState("saving");
    try {
      const res = await fetch("/api/nesting/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: keepalive && body.length < 60000,
      });
      if (!res.ok) throw new Error(String(res.status));
      lastBody.current = data;
      dirty.current = false;
      setSavedAt(Date.now());
      setState("saved");
    } catch {
      setState("error");
    }
  }, [kind]);

  // Load when the project changes (flush the previous project's pending changes first).
  React.useEffect(() => {
    const prev = prevProject.current;
    prevProject.current = projectId;
    loadedFor.current = "";
    lastBody.current = "";
    if (!projectId) return;
    if (latest.current.consumeFresh(projectId, kind)) { loadedFor.current = projectId; return; }

    let cancelled = false;
    setState("loading");
    fetch(`/api/nesting/workspace?projectId=${encodeURIComponent(projectId)}&kind=${kind}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((json: { data: unknown | null }) => {
        if (cancelled) return;
        if (json.data) {
          latest.current.restore(json.data);
          lastBody.current = JSON.stringify(json.data);
        } else if (prev) {
          latest.current.restore(null); // switching to a project without a nest yet: start clean
        }
        loadedFor.current = projectId;
        setState("idle");
        if (!json.data && !prev) { dirty.current = true; void save(projectId); } // adopt work done before choosing a project
      })
      .catch(() => { if (!cancelled) setState("error"); });

    return () => {
      cancelled = true;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (dirty.current) void save(projectId, true); // flush the project we are leaving
    };
  }, [projectId, kind, save]);

  // Debounced save on every change.
  React.useEffect(() => {
    if (!projectId || loadedFor.current !== projectId) return;
    dirty.current = true;
    const tick = () => {
      if (latest.current.busy?.()) { timer.current = setTimeout(tick, 1000); return; }
      timer.current = null;
      void save(projectId);
    };
    timer.current = setTimeout(tick, DEBOUNCE_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, save, ...deps]);

  // Leaving the page / closing the tab: save what is pending.
  React.useEffect(() => {
    const flush = () => { if (dirty.current) void save(prevProject.current, true); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [save]);

  return { state: projectId ? state : ("idle" as AutosaveState), savedAt };
}

export function AutosaveBadge({ state, savedAt, projectLabel }: { state: AutosaveState; savedAt: number | null; projectLabel?: string }) {
  if (state === "idle" && !savedAt) return null;
  const time = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {state === "saving" || state === "loading" ? (
        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {state === "loading" ? "Loading saved nest…" : "Saving…"}</>
      ) : state === "error" ? (
        <><CloudOff className="h-3.5 w-3.5 text-destructive" /> Auto-save failed — keep this page open and try changing something again</>
      ) : (
        <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Auto-saved{time ? ` at ${time}` : ""}{projectLabel ? ` to “${projectLabel}”` : ""}</>
      )}
    </p>
  );
}
