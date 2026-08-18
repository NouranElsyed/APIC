"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "DRAWING", label: "Drawing" },
  { value: "SPECIFICATION", label: "Specification" },
  { value: "CONTRACT", label: "Contract" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "TECHNICAL_DOCUMENT", label: "Technical Document" },
  { value: "SCOPE_OF_WORK", label: "Scope of Work" },
  { value: "NOTICE", label: "Notice" },
  { value: "MEETING_MINUTES", label: "Meeting Minutes" },
  { value: "EMAIL", label: "Mail" },
  { value: "OTHER", label: "Other" },
];

interface FormValues {
  title: string;
  category: string;
  projectId: string;
  revision: string;
  file: FileList | null;
}

export function UploadForm({
  open, onOpenChange, projects, onSaved, lockedProjectId, lockedProjectLabel, lockedCategory, title, description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: { id: string; name: string; number: string }[];
  onSaved: () => void;
  /** When set, the project field is pre-filled and locked (used from a project's own page). */
  lockedProjectId?: string;
  lockedProjectLabel?: string;
  /** When set, the category field is pre-filled and locked (used from a dedicated section like Notices, Mails, Scope of Work). */
  lockedCategory?: string;
  title?: string;
  description?: string;
}) {
  const { register, handleSubmit, control, reset, formState: { isSubmitting, errors } } = useForm<FormValues>({
    defaultValues: { title: "", category: lockedCategory ?? "OTHER", projectId: lockedProjectId ?? "", revision: "Rev. 00", file: null },
  });

  React.useEffect(() => {
    if (open) reset({ title: "", category: lockedCategory ?? "OTHER", projectId: lockedProjectId ?? "", revision: "Rev. 00", file: null });
  }, [open, reset, lockedProjectId, lockedCategory]);

  async function onSubmit(values: FormValues) {
    if (!values.file || values.file.length === 0) { toast.error("Please choose a file"); return; }
    if (!values.projectId) { toast.error("Please select a project"); return; }

    const fd = new FormData();
    fd.append("title", values.title);
    fd.append("category", values.category);
    fd.append("projectId", values.projectId);
    fd.append("revision", values.revision);
    fd.append("file", values.file[0]);

    const res = await fetch("/api/documents", { method: "POST", body: fd });
    if (!res.ok) { toast.error("Failed to upload document"); return; }
    toast.success("Document uploaded");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? "Upload Document"}</DialogTitle>
          <DialogDescription>{description ?? "Attach a document to a project. Files are stored locally in development."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title", { required: true })} placeholder="Fabrication Drawing Rev.02" />
            {errors.title && <p className="text-xs text-destructive">Title is required</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {!lockedCategory && (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Controller
                  control={control} name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Revision</Label>
              <Input {...register("revision")} placeholder="Rev. 00" />
            </div>
          </div>
          {lockedProjectId ? (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Input value={lockedProjectLabel ?? ""} disabled />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Controller
                control={control} name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>File</Label>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center hover:bg-muted">
              <UploadCloud className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Click to choose a file</span>
              <input type="file" className="hidden" {...register("file")} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
