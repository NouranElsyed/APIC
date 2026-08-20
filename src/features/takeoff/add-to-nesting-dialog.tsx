"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface NestingJobOption {
  id: string;
  name: string;
  material: string | null;
  thicknessMm: number | null;
  status: "DRAFT" | "READY";
}

export function AddToNestingDialog({
  open, onOpenChange, projectId, takeoffPartId, partDescription,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  takeoffPartId: string;
  partDescription: string;
}) {
  const [jobs, setJobs] = React.useState<NestingJobOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<"existing" | "new">("existing");
  const [selectedJobId, setSelectedJobId] = React.useState<string>("");
  const [newJobName, setNewJobName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/nesting/jobs?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: NestingJobOption[]) => {
        const draftJobs = data.filter((j) => j.status === "DRAFT");
        setJobs(draftJobs);
        setMode(draftJobs.length > 0 ? "existing" : "new");
        setSelectedJobId(draftJobs[0]?.id ?? "");
      })
      .finally(() => setLoading(false));
  }, [open, projectId]);

  async function handleSubmit() {
    setSubmitting(true);
    let jobId = selectedJobId;
    if (mode === "new") {
      if (!newJobName.trim()) { toast.error("Give the new nesting job a name"); setSubmitting(false); return; }
      const res = await fetch("/api/nesting/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: newJobName.trim() }),
      });
      if (!res.ok) { toast.error("Failed to create nesting job"); setSubmitting(false); return; }
      jobId = (await res.json()).id;
    }
    if (!jobId) { toast.error("Choose or create a nesting job"); setSubmitting(false); return; }

    const res = await fetch(`/api/nesting/jobs/${jobId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ takeoffPartId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Failed to add to nesting job");
      return;
    }
    toast.success("Added to nesting job");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Nesting</DialogTitle>
          <DialogDescription>Attach &quot;{partDescription}&quot; to a nesting job.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading jobs…</p>
        ) : (
          <div className="space-y-4">
            {jobs.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Existing draft jobs</Label>
                <Select value={mode === "existing" ? selectedJobId : "__new__"} onValueChange={(v) => {
                  if (v === "__new__") { setMode("new"); } else { setMode("existing"); setSelectedJobId(v); }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}{j.material ? ` — ${j.material}` : ""}{j.thicknessMm ? ` (${j.thicknessMm}mm)` : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Create new job…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {mode === "new" && (
              <div className="space-y-1.5">
                <Label className="text-xs">New job name</Label>
                <Input value={newJobName} onChange={(e) => setNewJobName(e.target.value)} placeholder="e.g. Job #002 — Riser plates" autoFocus />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || loading}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
