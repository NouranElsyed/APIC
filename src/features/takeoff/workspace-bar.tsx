"use client";
import * as React from "react";
import { toast } from "sonner";
import { FilePlus2, FolderKanban, FolderPlus, History as HistoryIcon, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useTakeoffProject } from "./project-context";
import type { HistoryEntry } from "./types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** The form inside the name window — mounted fresh every time the window opens, so it starts from `initial`. */
function NameForm({
  title, description, label, initial, confirmLabel, onSubmit, onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await onSubmit(clean);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="ws-name">{label}</Label>
        <Input
          id="ws-name"
          autoFocus
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={busy || !name.trim()}>{busy ? "Please wait…" : confirmLabel}</Button>
      </DialogFooter>
    </>
  );
}

/** A small "type a name" window, used for New project / Rename / Save as project. */
function NameDialog({
  open, onOpenChange, ...form
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <NameForm {...form} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type Prompt =
  | { kind: "newProject" }
  | { kind: "renameProject"; id: string; name: string }
  | { kind: "renameHistory"; id: string; name: string }
  | { kind: "saveHistory"; id: string; name: string }
  | null;

type Confirm = { kind: "deleteProject"; id: string; name: string } | { kind: "deleteHistory"; id: string; name: string } | null;

function HistoryDialog({
  open, onOpenChange, onPrompt, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPrompt: (p: Prompt) => void;
  onConfirm: (c: Confirm) => void;
}) {
  const { history, historyId, projects, refreshHistory, openHistory } = useTakeoffProject();
  React.useEffect(() => {
    if (open) void refreshHistory();
  }, [open, refreshHistory]);

  const sorted = React.useMemo(() => [...history].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [history]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>My nesting history</DialogTitle>
          <DialogDescription>
            Every import you make without a project open is saved here automatically, with its name and date. Open one to continue
            working, or save it as a project when you are done.
          </DialogDescription>
        </DialogHeader>
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet — import a DXF / CSV in the Nesting tab and it will appear.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {sorted.map((h: HistoryEntry) => {
              const active = h.id === historyId;
              const saved = h.savedProjectId ? projects.find((p) => p.id === h.savedProjectId) : undefined;
              return (
                <li key={h.id} className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center ${active ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={h.name}>{h.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Last changed {fmt(h.updatedAt)}</span>
                      {active && <Badge variant="default">Open now</Badge>}
                      {saved && <Badge variant="success">Saved as “{saved.name}”</Badge>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant={active ? "secondary" : "outline"} disabled={active} onClick={() => { openHistory(h.id); onOpenChange(false); }}>
                      Open
                    </Button>
                    <Button size="icon" variant="ghost" title="Save as project" aria-label="Save as project" onClick={() => onPrompt({ kind: "saveHistory", id: h.id, name: h.name })}>
                      <FolderPlus />
                    </Button>
                    <Button size="icon" variant="ghost" title="Rename" aria-label="Rename" onClick={() => onPrompt({ kind: "renameHistory", id: h.id, name: h.name })}>
                      <Pencil />
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete" aria-label="Delete" onClick={() => onConfirm({ kind: "deleteHistory", id: h.id, name: h.name })}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The bar above the Takeoff tabs: pick / create / rename / delete a project, open the user's nesting
 * history, and — while an import is only in the history — save it as a project.
 */
export function WorkspaceBar() {
  const {
    projects, projectId, setProjectId, history, historyId, startNewImport,
    createProject, renameProject, deleteProject, renameHistory, deleteHistory, saveHistoryAsProject,
  } = useTakeoffProject();
  const [prompt, setPrompt] = React.useState<Prompt>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const project = projects.find((p) => p.id === projectId);
  const entry = history.find((h) => h.id === historyId);

  async function submitPrompt(name: string) {
    if (!prompt) return;
    switch (prompt.kind) {
      case "newProject": {
        const p = await createProject(name);
        toast.success(`Project “${p.name}” created`);
        break;
      }
      case "renameProject": await renameProject(prompt.id, name); toast.success("Project renamed"); break;
      case "renameHistory": await renameHistory(prompt.id, name); toast.success("Renamed"); break;
      case "saveHistory": {
        const p = await saveHistoryAsProject(prompt.id, name);
        toast.success(`Saved as project “${p.name}”`);
        setHistoryOpen(false);
        break;
      }
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.kind === "deleteProject") await deleteProject(confirm.id);
      else await deleteHistory(confirm.id);
      toast.success("Deleted");
      setConfirm(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(false);
    }
  }

  const promptCfg = !prompt
    ? null
    : prompt.kind === "newProject"
      ? { title: "New project", description: "Creates an empty project and opens it. Its client can be set later.", label: "Project name", initial: "", confirmLabel: "Create project" }
      : prompt.kind === "renameProject"
        ? { title: "Rename project", description: undefined, label: "Project name", initial: prompt.name, confirmLabel: "Rename" }
        : prompt.kind === "renameHistory"
          ? { title: "Rename", description: undefined, label: "Name", initial: prompt.name, confirmLabel: "Rename" }
          : { title: "Save as project", description: "Creates a project with this name and copies everything into it (parts, settings, results). Your history entry stays as it is.", label: "Project name", initial: prompt.name, confirmLabel: "Save project" };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-end gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-72">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder={entry ? "— working in history —" : "Select a project"} /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {project && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" title="Rename project" aria-label="Rename project" onClick={() => setPrompt({ kind: "renameProject", id: project.id, name: project.name })}>
                <Pencil />
              </Button>
              <Button size="icon" variant="ghost" title="Delete project" aria-label="Delete project" onClick={() => setConfirm({ kind: "deleteProject", id: project.id, name: project.name })}>
                <Trash2 className="text-destructive" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <HistoryIcon /> History{history.length ? ` (${history.length})` : ""}
          </Button>
          <Button onClick={() => setPrompt({ kind: "newProject" })}>
            <FolderPlus /> New project
          </Button>
        </div>
      </div>

      {entry && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium" title={entry.name}>
              Working on: {entry.name}
              {entry.savedProjectId && projects.some((p) => p.id === entry.savedProjectId) && <Badge variant="success" className="ml-2">already saved as a project once</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">Saved automatically to your history. Press “Save as project” when you are finished.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setPrompt({ kind: "saveHistory", id: entry.id, name: entry.name })}>
              <FolderPlus /> Save as project
            </Button>
            <Button size="sm" variant="outline" title="Rename" onClick={() => setPrompt({ kind: "renameHistory", id: entry.id, name: entry.name })}>
              <Pencil /> Rename
            </Button>
            <Button size="sm" variant="outline" title="Close this import and start a fresh one" onClick={startNewImport}>
              <FilePlus2 /> New import
            </Button>
            <Button size="sm" variant="ghost" title="Delete this history entry" aria-label="Delete this history entry" onClick={() => setConfirm({ kind: "deleteHistory", id: entry.id, name: entry.name })}>
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        </div>
      )}

      {promptCfg && (
        <NameDialog
          open={!!prompt}
          onOpenChange={(v) => { if (!v) setPrompt(null); }}
          title={promptCfg.title}
          description={promptCfg.description}
          label={promptCfg.label}
          initial={promptCfg.initial}
          confirmLabel={promptCfg.confirmLabel}
          onSubmit={submitPrompt}
        />
      )}
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} onPrompt={setPrompt} onConfirm={setConfirm} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v && !deleting) setConfirm(null); }}
        title={confirm?.kind === "deleteProject" ? `Delete project “${confirm.name}”?` : `Delete “${confirm?.name ?? ""}” from your history?`}
        description={
          confirm?.kind === "deleteProject"
            ? "This permanently deletes the project and everything in it (documents, takeoff parts, nesting results). It cannot be undone."
            : "The saved import is removed from your history. A project you already saved from it is not affected."
        }
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={() => void runConfirm()}
      />
    </div>
  );
}
