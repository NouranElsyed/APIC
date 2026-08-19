"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Users2, Plus, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

export type MeetingStatus = "SCHEDULED" | "HELD" | "CANCELLED" | "POSTPONED";

const STATUS_OPTIONS: { value: MeetingStatus; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "HELD", label: "Held" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "POSTPONED", label: "Postponed" },
];

const STATUS_BADGE: Record<MeetingStatus, "default" | "success" | "destructive" | "warning" | "gray"> = {
  SCHEDULED: "default",
  HELD: "success",
  CANCELLED: "destructive",
  POSTPONED: "warning",
};

export interface ProjectMeetingMinute {
  id: string;
  meetingDate: string | Date;
  status: MeetingStatus;
  notes: string | null;
  createdBy: { name: string };
}

export function ProjectMeetingMinutesSection({
  projectId,
  meetings,
  canManage,
}: {
  projectId: string;
  meetings: ProjectMeetingMinute[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [meetingDate, setMeetingDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = React.useState<MeetingStatus>("SCHEDULED");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  function resetForm() {
    setMeetingDate(new Date().toISOString().slice(0, 10));
    setStatus("SCHEDULED");
    setNotes("");
  }

  async function handleAdd() {
    if (!meetingDate) { toast.error("Meeting date is required"); return; }
    setSubmitting(true);
    const res = await fetch("/api/meeting-minutes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingDate, status, notes: notes.trim() || null, projectId }),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error("Failed to add meeting"); return; }
    toast.success("Meeting added");
    resetForm();
    setAdding(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/meeting-minutes/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) { toast.error("Failed to delete"); return; }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-muted-foreground" /> Meeting Minutes
        </CardTitle>
        {canManage && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meeting Date</Label>
                <Input type="date" autoFocus value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as MeetingStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); resetForm(); }}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}

        {meetings.length === 0 && !adding ? (
          <EmptyState
            icon={<Users2 className="h-5 w-5" />}
            title="No meeting minutes added"
            description={canManage ? "Nothing added yet — use Add to add a meeting." : "Nothing added yet."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{formatDate(m.meetingDate)}</p>
                    <Badge variant={STATUS_BADGE[m.status]}>{STATUS_OPTIONS.find((s) => s.value === m.status)?.label ?? m.status}</Badge>
                  </div>
                  {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                  <p className="text-xs text-muted-foreground">{m.createdBy.name}</p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost" size="icon" onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                  >
                    {deletingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
