"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Plus, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

export interface ProjectNotice {
  id: string;
  title: string;
  description: string | null;
  noticeDate: string | Date;
  createdBy: { name: string };
}

export function ProjectNoticesSection({
  projectId,
  notices,
  canManage,
}: {
  projectId: string;
  notices: ProjectNotice[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [noticeDate, setNoticeDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  function resetForm() {
    setTitle("");
    setDescription("");
    setNoticeDate(new Date().toISOString().slice(0, 10));
  }

  async function handleAdd() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSubmitting(true);
    const res = await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim() || null, noticeDate, projectId }),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error("Failed to add notice"); return; }
    toast.success("Notice added");
    resetForm();
    setAdding(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/notices/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) { toast.error("Failed to delete"); return; }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" /> Notices
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
                <Label>Title</Label>
                <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notice title" />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); resetForm(); }}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}

        {notices.length === 0 && !adding ? (
          <EmptyState
            icon={<Bell className="h-5 w-5" />}
            title="No notices added"
            description={canManage ? "Nothing added yet — use Add to add a notice." : "Nothing added yet."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {notices.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{n.title}</p>
                  {n.description && <p className="text-xs text-muted-foreground">{n.description}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatDate(n.noticeDate)} · {n.createdBy.name}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost" size="icon" onClick={() => handleDelete(n.id)} disabled={deletingId === n.id}
                  >
                    {deletingId === n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
