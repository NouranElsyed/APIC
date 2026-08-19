"use client";
import * as React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sigma } from "lucide-react";
import { toast } from "sonner";
import {
  computeTakeoffPart, explainTakeoffPart, buildDefaultAreaFormula,
} from "@/server/calc/takeoff";
import type { TakeoffPartRow, PartType, PartSide } from "./types";

interface FormState {
  itemNo: string;
  description: string;
  partType: PartType;
  side: PartSide;
  qty: string;
  thicknessMm: string;
  paintSides: "1" | "2";
  buyWeightKg: string;
  areaFormula: string;
  areaFormulaTouched: boolean;
  // geometry, per part type
  width: string; length: string; cutoffFormula: string; // PLATE
  d1: string; d2: string; height: string; // CONE
  od: string; pipeLength: string; // PIPE
  profile: string; hrLength: string; weightPerMeter: string; paintAreaPerMeter: string; // HOT_ROLLED
}

function emptyForm(itemNo: number): FormState {
  return {
    itemNo: String(itemNo),
    description: "",
    partType: "PLATE",
    side: "EXTERNAL",
    qty: "1",
    thicknessMm: "",
    paintSides: "2",
    buyWeightKg: "",
    areaFormula: "",
    areaFormulaTouched: false,
    width: "", length: "", cutoffFormula: "",
    d1: "", d2: "", height: "",
    od: "", pipeLength: "",
    profile: "", hrLength: "", weightPerMeter: "", paintAreaPerMeter: "",
  };
}

function fromPart(part: TakeoffPartRow): FormState {
  const g = (part.geometry ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    itemNo: String(part.itemNo),
    description: part.description,
    partType: part.partType,
    side: part.side,
    qty: String(part.qty),
    thicknessMm: part.thicknessMm != null ? String(part.thicknessMm) : "",
    paintSides: part.paintSides === 1 ? "1" : "2",
    buyWeightKg: part.buyWeightKg != null ? String(part.buyWeightKg) : "",
    areaFormula: part.areaFormula ?? "",
    areaFormulaTouched: true,
    width: s(g.width), length: part.partType === "PLATE" ? s(g.length) : "", cutoffFormula: s(g.cutoffFormula),
    d1: s(g.d1), d2: s(g.d2), height: s(g.height),
    od: s(g.od), pipeLength: part.partType === "PIPE" ? s(g.length) : "",
    profile: s(g.profile), hrLength: part.partType === "HOT_ROLLED" ? s(g.length) : "",
    weightPerMeter: s(g.weightPerMeter), paintAreaPerMeter: s(g.paintAreaPerMeter),
  };
}

function num(v: string): number {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : 0;
}

function buildGeometry(f: FormState): Record<string, unknown> {
  switch (f.partType) {
    case "PLATE":
      return { width: num(f.width), length: num(f.length), cutoffFormula: f.cutoffFormula.trim() || null };
    case "CONE":
      return { d1: num(f.d1), d2: num(f.d2), height: num(f.height) };
    case "PIPE":
      return { od: num(f.od), length: num(f.pipeLength) };
    case "HOT_ROLLED":
      return {
        profile: f.profile.trim(),
        length: num(f.hrLength),
        weightPerMeter: num(f.weightPerMeter),
        paintAreaPerMeter: f.paintAreaPerMeter.trim() ? num(f.paintAreaPerMeter) : null,
      };
  }
}

function isFormUsable(f: FormState): boolean {
  if (f.description.trim() === "" || num(f.qty) <= 0) return false;
  if (f.partType !== "HOT_ROLLED" && num(f.thicknessMm) <= 0) return false;
  switch (f.partType) {
    case "PLATE": return num(f.width) > 0 && num(f.length) > 0;
    case "CONE": return num(f.d1) > 0 && num(f.d2) > 0 && num(f.height) > 0;
    case "PIPE": return num(f.od) > 0 && num(f.pipeLength) > 0;
    case "HOT_ROLLED": return f.profile.trim() !== "" && num(f.hrLength) > 0 && num(f.weightPerMeter) > 0;
  }
}

function toComputeInput(f: FormState) {
  const geometry = buildGeometry(f);
  const areaFormula = f.partType === "HOT_ROLLED"
    ? null
    : (f.areaFormula.trim() || buildDefaultAreaFormula(f.partType, geometry));
  return {
    partType: f.partType,
    geometry,
    qty: num(f.qty),
    thicknessMm: f.partType === "HOT_ROLLED" ? null : num(f.thicknessMm),
    paintSides: Number(f.paintSides),
    areaFormula,
    buyWeightKg: f.buyWeightKg.trim() ? num(f.buyWeightKg) : null,
  };
}

function toPayload(f: FormState, drawingId: string) {
  const base = {
    drawingId,
    itemNo: Number(f.itemNo) || 0,
    description: f.description.trim(),
    side: f.side,
    qty: num(f.qty),
    paintSides: (f.paintSides === "1" ? 1 : 2) as 1 | 2,
    buyWeightKg: f.buyWeightKg.trim() ? num(f.buyWeightKg) : null,
  };
  const geometry = buildGeometry(f);
  if (f.partType === "HOT_ROLLED") {
    return { ...base, partType: "HOT_ROLLED" as const, thicknessMm: null, geometry };
  }
  return {
    ...base,
    partType: f.partType,
    thicknessMm: num(f.thicknessMm),
    geometry,
    areaFormula: f.areaFormula.trim() || null,
  };
}

const PART_TYPE_LABEL: Record<PartType, string> = {
  PLATE: "Plate",
  HOT_ROLLED: "Hot Rolled",
  CONE: "Cone",
  PIPE: "Pipe",
};

export function PartForm({
  open, onOpenChange, drawingId, editing, nextItemNo, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawingId: string;
  editing: TakeoffPartRow | null;
  nextItemNo: number;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState<FormState>(() => (editing ? fromPart(editing) : emptyForm(nextItemNo)));
  const [submitting, setSubmitting] = React.useState(false);
  const [showEquation, setShowEquation] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setF(editing ? fromPart(editing) : emptyForm(nextItemNo));
    setShowEquation(false);
  }, [open, editing, nextItemNo]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  // Keep the (editable) area formula in sync with geometry until the user
  // types into it directly — same behaviour as an Excel default that gets
  // overwritten the moment you edit the cell yourself.
  const geometry = buildGeometry(f);
  const defaultFormula = f.partType === "HOT_ROLLED" ? "" : buildDefaultAreaFormula(f.partType, geometry);
  React.useEffect(() => {
    if (!f.areaFormulaTouched) {
      setF((prev) => (prev.areaFormula === defaultFormula ? prev : { ...prev, areaFormula: defaultFormula }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFormula, f.areaFormulaTouched]);

  const computed = computeTakeoffPart(toComputeInput(f));
  const explanation = explainTakeoffPart(toComputeInput(f));
  const usable = isFormUsable(f);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!usable) { toast.error("Please fill in the required fields for this part type"); return; }
    setSubmitting(true);
    const url = editing ? `/api/takeoff/parts/${editing.id}` : "/api/takeoff/parts";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(f, drawingId)),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error(editing ? "Failed to update item" : "Failed to add item"); return; }
    toast.success(editing ? "Item updated" : "Item added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Item" : "Add Item"}</DialogTitle>
          <DialogDescription>
            Choose the part type first — the fields below adjust to match it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Item No.</Label>
              <Input type="number" value={f.itemNo} onChange={(e) => set("itemNo", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Part Type</Label>
              <Select value={f.partType} onValueChange={(v) => setF((prev) => ({ ...prev, partType: v as PartType, areaFormulaTouched: false }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PART_TYPE_LABEL) as PartType[]).map((pt) => (
                    <SelectItem key={pt} value={pt}>{PART_TYPE_LABEL[pt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. PL 20 mm end cap" />
          </div>

          {/* Type-specific geometry */}
          {f.partType === "PLATE" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Thickness (mm)</Label>
                <Input type="number" step="any" value={f.thicknessMm} onChange={(e) => set("thicknessMm", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Width (m)</Label>
                <Input type="number" step="any" value={f.width} onChange={(e) => set("width", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Length (m)</Label>
                <Input type="number" step="any" value={f.length} onChange={(e) => set("length", e.target.value)} />
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Cut-off area (optional) — formula, e.g. PI()*0.15^2</Label>
                <Input value={f.cutoffFormula} onChange={(e) => set("cutoffFormula", e.target.value)} placeholder="Leave blank if there's no hole/cut-out" />
              </div>
            </div>
          )}

          {f.partType === "CONE" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Thickness (mm)</Label>
                <Input type="number" step="any" value={f.thicknessMm} onChange={(e) => set("thicknessMm", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Height (m)</Label>
                <Input type="number" step="any" value={f.height} onChange={(e) => set("height", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>D1 (m)</Label>
                <Input type="number" step="any" value={f.d1} onChange={(e) => set("d1", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>D2 (m)</Label>
                <Input type="number" step="any" value={f.d2} onChange={(e) => set("d2", e.target.value)} />
              </div>
            </div>
          )}

          {f.partType === "PIPE" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Thickness (mm)</Label>
                <Input type="number" step="any" value={f.thicknessMm} onChange={(e) => set("thicknessMm", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>OD (m)</Label>
                <Input type="number" step="any" value={f.od} onChange={(e) => set("od", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Length (m)</Label>
                <Input type="number" step="any" value={f.pipeLength} onChange={(e) => set("pipeLength", e.target.value)} />
              </div>
            </div>
          )}

          {f.partType === "HOT_ROLLED" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Profile</Label>
                <Input value={f.profile} onChange={(e) => set("profile", e.target.value)} placeholder="e.g. IPE 120" />
              </div>
              <div className="space-y-1.5">
                <Label>Length (m)</Label>
                <Input type="number" step="any" value={f.hrLength} onChange={(e) => set("hrLength", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Weight per metre (kg/m)</Label>
                <Input type="number" step="any" value={f.weightPerMeter} onChange={(e) => set("weightPerMeter", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Paint area per metre (m²/m) — optional</Label>
                <Input type="number" step="any" value={f.paintAreaPerMeter} onChange={(e) => set("paintAreaPerMeter", e.target.value)} />
              </div>
            </div>
          )}

          {/* Excel-style, always-editable area formula for sheet-based types */}
          {f.partType !== "HOT_ROLLED" && (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Area formula (per piece, single face) — editable</Label>
                {f.areaFormulaTouched && (
                  <button type="button" className="text-[11px] text-primary underline" onClick={() => setF((prev) => ({ ...prev, areaFormulaTouched: false }))}>
                    Reset to default
                  </button>
                )}
              </div>
              <Input
                className="font-mono text-xs"
                value={f.areaFormula || defaultFormula}
                onChange={(e) => setF((prev) => ({ ...prev, areaFormula: e.target.value, areaFormulaTouched: true }))}
                placeholder={defaultFormula}
              />
              <p className="text-[11px] text-muted-foreground">
                vars: {f.partType === "PLATE" ? "width, length" : f.partType === "CONE" ? "d1, d2, height" : "od, length"}, thk, qty — functions: PI(), sqrt(), abs()
              </p>
              {computed.formulaError && <p className="text-xs font-medium text-destructive">{computed.formulaError}</p>}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Qty</Label>
              <Input type="number" value={f.qty} onChange={(e) => set("qty", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Side</Label>
              <Select value={f.side} onValueChange={(v) => set("side", v as PartSide)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXTERNAL">External</SelectItem>
                  <SelectItem value="INTERNAL">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Paint</Label>
              <Select value={f.paintSides} onValueChange={(v) => set("paintSides", v as "1" | "2")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 side</SelectItem>
                  <SelectItem value="2">2 sides</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Buy weight (kg) — optional, for scrap tracking</Label>
            <Input type="number" step="any" value={f.buyWeightKg} onChange={(e) => set("buyWeightKg", e.target.value)} />
          </div>

          <div className="rounded-md border border-border bg-primary/5 p-3">
            <button type="button" className="flex w-full items-center justify-between text-xs font-medium text-foreground" onClick={() => setShowEquation((v) => !v)}>
              <span className="flex items-center gap-1.5"><Sigma className="h-3.5 w-3.5" /> Equation preview</span>
              <span className="text-muted-foreground">{showEquation ? "Hide" : "Show"}</span>
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground">Total Area</span><div className="font-semibold tabular-nums">{usable ? computed.totalArea.toFixed(3) : "—"} m²</div></div>
              <div><span className="text-muted-foreground">Paint Area</span><div className="font-semibold tabular-nums">{usable ? computed.paintAreaSqm.toFixed(3) : "—"} m²</div></div>
              <div><span className="text-muted-foreground">Weight</span><div className="font-semibold tabular-nums text-primary">{usable ? computed.weightKg.toFixed(1) : "—"} kg</div></div>
            </div>
            {showEquation && (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-border pt-2 text-xs">
                {explanation.lines.map((line) => (
                  <div key={line.label} className="min-w-[160px]">
                    <div className="text-muted-foreground">{line.label}</div>
                    <div className="font-mono text-foreground">{line.formula} <span className="text-muted-foreground">=</span> <span className="font-semibold">{line.result}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
