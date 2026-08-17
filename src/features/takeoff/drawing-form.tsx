"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FormValues {
  drawingNumber: string;
  title: string;
  weightFromDwg: string;
}

export function DrawingForm({
  open, onOpenChange, projectId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onSaved: () => void;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting, errors } } = useForm<FormValues>({
    defaultValues: { drawingNumber: "", title: "", weightFromDwg: "" },
  });

  React.useEffect(() => {
    if (open) reset({ drawingNumber: "", title: "", weightFromDwg: "" });
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    const res = await fetch("/api/takeoff/drawings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        drawingNumber: values.drawingNumber,
        title: values.title,
        weightFromDwg: values.weightFromDwg ? Number(values.weightFromDwg) : null,
      }),
    });
    if (!res.ok) { toast.error("Failed to add drawing"); return; }
    toast.success("Drawing added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Drawing</DialogTitle>
          <DialogDescription>Add a new fabrication drawing to enter parts under.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Drawing Number</Label>
            <Input {...register("drawingNumber", { required: true })} placeholder="13334036" />
            {errors.drawingNumber && <p className="text-xs text-destructive">Drawing number is required</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title", { required: true })} placeholder="Existing Riser Ø4657" />
            {errors.title && <p className="text-xs text-destructive">Title is required</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Weight from Drawing (kg) — optional</Label>
            <Input type="number" step="any" {...register("weightFromDwg")} placeholder="2686" />
            <p className="text-[11px] text-muted-foreground">Used for a variance check against the calculated weight.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Drawing
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
