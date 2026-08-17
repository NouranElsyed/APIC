"use client";
import * as React from "react";
import { Plus, Trash2, Loader2, Grid3x3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { computeTakeoffPart } from "@/server/calc/takeoff";

// Free-text row shape — mirrors the Excel columns exactly (item, description,
// ext W/L, int W/L, qty, thickness). Kept as strings while editing so the
// user can type freely (including partial numbers); parsed to numbers only
// on save.
interface GridRow {
  key: string;
  itemNo: string;
  description: string;
  extWidth: string;
  extLength: string;
  intWidth: string;
  intLength: string;
  qty: string;
  thicknessMm: string;
}

let rowKeySeq = 0;
function blankRow(itemNo: number): GridRow {
  rowKeySeq += 1;
  return {
    key: `r${rowKeySeq}`,
    itemNo: String(itemNo),
    description: "",
    extWidth: "",
    extLength: "",
    intWidth: "",
    intLength: "",
    qty: "1",
    thicknessMm: "",
  };
}

function toComputed(row: GridRow) {
  return computeTakeoffPart({
    extWidth: row.extWidth ? Number(row.extWidth) : null,
    extLength: row.extLength ? Number(row.extLength) : null,
    intWidth: row.intWidth ? Number(row.intWidth) : null,
    intLength: row.intLength ? Number(row.intLength) : null,
    qty: Number(row.qty) || 0,
    thicknessMm: Number(row.thicknessMm) || 0,
  });
}

function isRowUsable(row: GridRow) {
  return row.description.trim() !== "" && Number(row.qty) > 0 && Number(row.thicknessMm) > 0;
}

const cellInputClass =
  "h-8 w-full border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary";

export function PartGridEntry({
  open, onOpenChange, drawingId, drawingLabel, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawingId: string;
  drawingLabel: string;
  onSaved: () => void;
}) {
  const [rows, setRows] = React.useState<GridRow[]>([blankRow(1), blankRow(2), blankRow(3)]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      rowKeySeq = 0;
      setRows([blankRow(1), blankRow(2), blankRow(3)]);
    }
  }, [open]);

  function updateRow(key: string, field: keyof GridRow, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow(prev.length + 1)]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const usableRows = rows.filter(isRowUsable);
  const grandArea = usableRows.reduce((s, r) => s + toComputed(r).totalArea, 0);
  const grandWeight = usableRows.reduce((s, r) => s + toComputed(r).weightKg, 0);

  async function handleSave() {
    if (usableRows.length === 0) {
      toast.error("Enter at least one row (description, qty and thickness are required)");
      return;
    }
    setSaving(true);
    const payload = {
      drawingId,
      rows: usableRows.map((r) => ({
        itemNo: Number(r.itemNo) || 0,
        description: r.description,
        extWidth: r.extWidth ? Number(r.extWidth) : null,
        extLength: r.extLength ? Number(r.extLength) : null,
        intWidth: r.intWidth ? Number(r.intWidth) : null,
        intLength: r.intLength ? Number(r.intLength) : null,
        qty: Number(r.qty) || 0,
        thicknessMm: Number(r.thicknessMm) || 0,
      })),
    };
    const res = await fetch("/api/takeoff/parts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save rows"); return; }
    toast.success(`${usableRows.length} part(s) added`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-muted-foreground" /> Grid Entry — {drawingLabel}
          </DialogTitle>
          <DialogDescription>
            Type parts directly into the table, like the Excel sheet. Area, volume and weight are calculated live per row.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-14 border-b border-border px-2 py-2 text-left">Item</th>
                <th className="min-w-[180px] border-b border-border px-2 py-2 text-left">Description</th>
                <th className="w-24 border-b border-l border-border px-2 py-2 text-right">Ext. W (m)</th>
                <th className="w-24 border-b border-border px-2 py-2 text-right">Ext. L (m)</th>
                <th className="w-24 border-b border-l border-border px-2 py-2 text-right">Int. W (m)</th>
                <th className="w-24 border-b border-border px-2 py-2 text-right">Int. L (m)</th>
                <th className="w-16 border-b border-l border-border px-2 py-2 text-right">Qty</th>
                <th className="w-20 border-b border-border px-2 py-2 text-right">Thk (mm)</th>
                <th className="w-24 border-b border-l border-border px-2 py-2 text-right">T. Area (m²)</th>
                <th className="w-24 border-b border-border px-2 py-2 text-right">Weight (kg)</th>
                <th className="w-10 border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const computed = toComputed(row);
                const usable = isRowUsable(row);
                return (
                  <tr key={row.key} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                    <td className="px-1 py-0.5">
                      <Input className={cellInputClass} value={row.itemNo} onChange={(e) => updateRow(row.key, "itemNo", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={cellInputClass} value={row.description} placeholder="PL 20 mm" onChange={(e) => updateRow(row.key, "description", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.extWidth} onChange={(e) => updateRow(row.key, "extWidth", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.extLength} onChange={(e) => updateRow(row.key, "extLength", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.intWidth} onChange={(e) => updateRow(row.key, "intWidth", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.intLength} onChange={(e) => updateRow(row.key, "intLength", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" value={row.qty} onChange={(e) => updateRow(row.key, "qty", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.thicknessMm} onChange={(e) => updateRow(row.key, "thicknessMm", e.target.value)} />
                    </td>
                    <td className={`border-l border-border px-2 py-0.5 text-right tabular-nums ${usable ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {usable ? computed.totalArea.toFixed(3) : "—"}
                    </td>
                    <td className={`px-2 py-0.5 text-right font-medium tabular-nums ${usable ? "text-primary" : "text-muted-foreground/50"}`}>
                      {usable ? computed.weightKg.toFixed(1) : "—"}
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRow(row.key)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>
          <div className="flex items-center gap-4 rounded-lg bg-secondary px-4 py-2 text-sm">
            <span className="text-muted-foreground">
              {usableRows.length} row{usableRows.length === 1 ? "" : "s"} ready
            </span>
            <span>
              Total Area: <span className="font-semibold text-foreground">{grandArea.toFixed(3)} m²</span>
            </span>
            <span>
              Total Weight: <span className="font-semibold text-primary">{grandWeight.toFixed(1)} kg</span>
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save {usableRows.length > 0 ? `${usableRows.length} Part(s)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
