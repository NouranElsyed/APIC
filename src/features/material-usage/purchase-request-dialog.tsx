"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Printer, ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ReqRow } from "./requirements";

const today = () => new Date().toISOString().slice(0, 10);
const unitLabel = (u: string) => (u.toLowerCase() === "sheet" ? "sheets" : u);

/** Turns the missing materials into a real purchase order (one supplier), through POST /api/purchase-orders. */
export function PurchaseRequestDialog({ open, onOpenChange, rows, suppliers, currency, projectId }: {
  open: boolean; onOpenChange: (v: boolean) => void; rows: ReqRow[]; suppliers: { id: string; name: string }[]; currency: string; projectId: string;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<Record<string, { on: boolean; qty: string; price: string }>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ id: string; number: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDone(null);
    setSupplierId((cur) => cur || suppliers[0]?.id || "");
    setLines(Object.fromEntries(rows.map((r) => [r.materialId!, { on: true, qty: String(r.toOrder), price: "" }])));
  }, [open, rows, suppliers]);

  const picked = rows.filter((r) => lines[r.materialId!]?.on && Number(lines[r.materialId!]?.qty) > 0);
  const set = (id: string, patch: Partial<{ on: boolean; qty: string; price: string }>) => setLines((l) => ({ ...l, [id]: { ...l[id], ...patch } }));

  const submit = async () => {
    if (!supplierId) return toast.error("Choose a supplier");
    if (!picked.length) return toast.error("Select at least one line with a quantity");
    setBusy(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, supplierId, currency, orderDate: today(), expectedDate: expected || null, paymentTerms: terms || null, notes: notes || null,
          lines: picked.map((r) => { const l = lines[r.materialId!]; return { materialId: r.materialId, qty: Number(l.qty), unitPrice: l.price.trim() === "" ? null : Number(l.price) }; }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not create the purchase order");
      setDone({ id: body.id, number: body.number });
      toast.success(`Purchase order ${body.number} created`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the purchase order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-3xl">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <DialogTitle>Purchase order {done.number} created</DialogTitle>
            <DialogDescription>The quantities are now on order, so the status of these materials moved to &ldquo;On Order&rdquo;.</DialogDescription>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <a href={`/print/purchase-orders/${done.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50"><Printer className="h-4 w-4" />Print / PDF</a>
              <Link href="/procurement" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50">Open Procurement</Link>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create Purchase Request</DialogTitle>
              <DialogDescription>Missing materials, ready to be ordered from one supplier. Change the quantities or untick lines you do not want in this order.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Supplier</Label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                    {!suppliers.length && <option value="">No suppliers yet — add one in Procurement</option>}
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Expected delivery</Label><Input type="date" value={expected} min={today()} onChange={(e) => setExpected(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Payment terms (optional)</Label><Input value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={200} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Notes (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="w-8 p-2" /><th className="p-2 text-left">Material</th><th className="p-2 text-right">Qty to order</th><th className="p-2 text-right">Unit price ({currency})</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => {
                      const l = lines[r.materialId!] ?? { on: true, qty: String(r.toOrder), price: "" };
                      return (
                        <tr key={r.id} className={cn(!l.on && "opacity-50")}>
                          <td className="p-2"><input type="checkbox" checked={l.on} onChange={(e) => set(r.materialId!, { on: e.target.checked })} /></td>
                          <td className="p-2"><p className="font-medium">{r.spec}</p><p className="text-xs text-muted-foreground">{r.type} · {r.grade}</p></td>
                          <td className="p-2"><div className="ml-auto flex w-40 items-center gap-1.5"><Input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(r.materialId!, { qty: e.target.value })} className="h-9 text-right" /><span className="w-10 text-xs text-muted-foreground">{unitLabel(r.unit)}</span></div></td>
                          <td className="p-2"><Input type="number" min={0} step="any" placeholder="—" value={l.price} onChange={(e) => set(r.materialId!, { price: e.target.value })} className="ml-auto h-9 w-32 text-right" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void submit()} disabled={busy || !suppliers.length || !picked.length}>
                {busy ? <Loader2 className="animate-spin" /> : <ShoppingCart />} Create PO ({picked.length} line{picked.length === 1 ? "" : "s"})
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
