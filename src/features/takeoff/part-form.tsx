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
import { computeTakeoffPart } from "@/server/calc/takeoff";
import type { TakeoffPartRow } from "./types";

interface FormValues {
  itemNo: string;
  description: string;
  extWidth: string;
  extLength: string;
  intWidth: string;
  intLength: string;
  qty: string;
  thicknessMm: string;
}

const EMPTY: FormValues = {
  itemNo: "", description: "", extWidth: "", extLength: "",
  intWidth: "", intLength: "", qty: "1", thicknessMm: "",
};

function toRow(v: FormValues) {
  return {
    itemNo: Number(v.itemNo) || 0,
    description: v.description,
    extWidth: v.extWidth ? Number(v.extWidth) : null,
    extLength: v.extLength ? Number(v.extLength) : null,
    intWidth: v.intWidth ? Number(v.intWidth) : null,
    intLength: v.intLength ? Number(v.intLength) : null,
    qty: Number(v.qty) || 0,
    thicknessMm: Number(v.thicknessMm) || 0,
  };
}

export function PartForm({
  open, onOpenChange, drawingId, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawingId: string;
  editing: TakeoffPartRow | null;
  onSaved: () => void;
}) {
  const { register, handleSubmit, reset, watch, formState: { isSubmitting, errors } } = useForm<FormValues>({
    defaultValues: EMPTY,
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      reset({
        itemNo: String(editing.itemNo),
        description: editing.description,
        extWidth: editing.extWidth?.toString() ?? "",
        extLength: editing.extLength?.toString() ?? "",
        intWidth: editing.intWidth?.toString() ?? "",
        intLength: editing.intLength?.toString() ?? "",
        qty: String(editing.qty),
        thicknessMm: String(editing.thicknessMm),
      });
    } else {
      reset(EMPTY);
    }
  }, [open, editing, reset]);

  const values = watch();
  const preview = React.useMemo(() => computeTakeoffPart(toRow(values)), [values]);

  async function onSubmit(values: FormValues) {
    const payload = { drawingId, ...toRow(values) };
    const res = editing
      ? await fetch(`/api/takeoff/parts/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/takeoff/parts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    if (!res.ok) { toast.error(editing ? "Failed to update part" : "Failed to add part"); return; }
    toast.success(editing ? "Part updated" : "Part added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Part" : "Add Part"}</DialogTitle>
          <DialogDescription>
            Enter dimensions and thickness — area, volume and weight are calculated automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Item No.</Label>
              <Input type="number" {...register("itemNo", { required: true })} placeholder="1" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Description</Label>
              <Input {...register("description", { required: true })} placeholder="PL 20 mm" />
              {errors.description && <p className="text-xs text-destructive">Description is required</p>}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">External Dimensions (m)</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Width</Label>
                <Input type="number" step="any" {...register("extWidth")} placeholder="0.24" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Length</Label>
                <Input type="number" step="any" {...register("extLength")} placeholder="14.9" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Internal Dimensions (m) — optional</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Width</Label>
                <Input type="number" step="any" {...register("intWidth")} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Length</Label>
                <Input type="number" step="any" {...register("intLength")} placeholder="—" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Qty</Label>
              <Input type="number" {...register("qty", { required: true })} placeholder="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Thickness (mm)</Label>
              <Input type="number" step="any" {...register("thicknessMm", { required: true })} placeholder="20" />
              {errors.thicknessMm && <p className="text-xs text-destructive">Thickness is required</p>}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 rounded-lg bg-secondary p-3 text-center">
            <div>
              <p className="text-[11px] text-muted-foreground">Unit Area</p>
              <p className="text-sm font-semibold text-foreground">{preview.totalUnitArea.toFixed(3)} m²</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Total Area</p>
              <p className="text-sm font-semibold text-foreground">{preview.totalArea.toFixed(3)} m²</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Volume</p>
              <p className="text-sm font-semibold text-foreground">{preview.volume.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Weight</p>
              <p className="text-sm font-semibold text-primary">{preview.weightKg.toFixed(1)} kg</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Add Part"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
