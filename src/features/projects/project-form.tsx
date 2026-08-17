"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { projectSchema } from "@/server/validators/project";
import type { z } from "zod";

type ProjectInput = z.input<typeof projectSchema>;
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { CustomerOption, ProjectRow } from "./types";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
];

export function ProjectForm({
  open,
  onOpenChange,
  customers,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: CustomerOption[];
  project?: ProjectRow | null;
  onSaved: () => void;
}) {
  const isEdit = !!project;
  const {
    register, handleSubmit, control, reset, formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      number: "", name: "", customerId: "", description: "", status: "DRAFT", revision: "Rev. 00", startDate: "", endDate: "",
    },
  });

  React.useEffect(() => {
    if (open) {
      reset(
        project
          ? {
              number: project.number,
              name: project.name,
              customerId: project.customer.id,
              description: project.description ?? "",
              status: project.status,
              revision: project.revision,
              startDate: project.startDate ? project.startDate.slice(0, 10) : "",
              endDate: project.endDate ? project.endDate.slice(0, 10) : "",
            }
          : { number: "", name: "", customerId: "", description: "", status: "DRAFT", revision: "Rev. 00", startDate: "", endDate: "" }
      );
    }
  }, [open, project, reset]);

  async function onSubmit(values: ProjectInput) {
    const url = isEdit ? `/api/projects/${project!.id}` : "/api/projects";
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.formErrors?.[0] || "Failed to save project");
      return;
    }
    toast.success(isEdit ? "Project updated" : "Project created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Project" : "New Project"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update project details." : "Fill in the details to create a new project."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Project Number</Label>
              <Input {...register("number")} placeholder="PRJ-2026-001" />
              {errors.number && <p className="text-xs text-destructive">{errors.number.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Revision</Label>
              <Input {...register("revision")} placeholder="Rev. 00" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Project Name</Label>
            <Input {...register("name")} placeholder="Riser Duct Fabrication" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Controller
              control={control}
              name="customerId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.customerId && <p className="text-xs text-destructive">{errors.customerId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea {...register("description")} rows={3} placeholder="Scope of work..." />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" {...register("startDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("endDate")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
