"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, PackageCheck, Pencil, Plus, Printer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { receiptLimit, OVER_RECEIPT_TOLERANCE_PCT, type PoState } from "./procurement";
import type { PurchaseOrderDTO } from "@/server/services/purchasing.service";
import type { SupplierDTO } from "@/server/services/suppliers.service";
import { joinTerms, parseTerms, TermsEditor } from "./terms-editor";
import { api, Empty, Field, fmtDate, money, num, Pill, selectClass, Td, Th, today } from "./ui";

export interface ProjectOpt { id: string; number: string; name: string }
interface ToOrder { materialId: string; code: string | null; description: string; spec: string | null; unit: string; requiredQty: number; ordered: number; remaining: number }

const STATE: Record<PoState, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  NOT_RECEIVED: { label: "Not received", tone: "muted" }, PARTIAL: { label: "Partly received", tone: "warn" }, RECEIVED: { label: "Received", tone: "good" }, CANCELLED: { label: "Cancelled", tone: "bad" },
};

export function OrdersPanel({ orders, suppliers, projects, canEdit, canReceive }: { orders: PurchaseOrderDTO[]; suppliers: SupplierDTO[]; projects: ProjectOpt[]; canEdit: boolean; canReceive: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [receiving, setReceiving] = React.useState<PurchaseOrderDTO | null>(null);
  const [editing, setEditing] = React.useState<PurchaseOrderDTO | null>(null);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function cancel(po: PurchaseOrderDTO) {
    if (!window.confirm(`Cancel ${po.number}? Its lines are removed from the project's Materials.`)) return;
    try { await api(`/api/purchase-orders/${po.id}`, { method: "PATCH", body: { status: "CANCELLED" } }); toast.success(`${po.number} cancelled`); router.refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not cancel"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{canEdit && <Button onClick={() => setCreating(true)}><Plus /> New purchase order</Button>}</div>
      {orders.length === 0 ? <Empty text="No purchase orders yet. Create one from a project's materials." /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50"><tr><Th /><Th>PO</Th><Th>Project</Th><Th>Supplier</Th><Th>Date</Th><Th>Expected</Th><Th right>Total</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">
              {orders.map((po) => {
                const isOpen = open.has(po.id);
                const st = STATE[po.state];
                return (
                  <React.Fragment key={po.id}>
                    <tr className="hover:bg-muted/30">
                      <Td className="w-8"><button className="text-muted-foreground" aria-label={isOpen ? "Hide lines" : "Show lines"} onClick={() => toggle(po.id)}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></Td>
                      <Td className="font-medium">{po.number}</Td>
                      <Td><Link href={`/projects/${po.project.id}/planning`} className="hover:underline">{po.project.number}</Link><p className="max-w-[180px] truncate text-xs text-muted-foreground">{po.project.name}</p></Td>
                      <Td>{po.supplier.name}</Td><Td>{fmtDate(po.orderDate)}</Td><Td>{fmtDate(po.expectedDate)}</Td>
                      <Td right>{po.total > 0 ? money(po.total, po.currency) : "—"}</Td>
                      <Td><Pill tone={st.tone}>{st.label}</Pill></Td>
                      <Td className="whitespace-nowrap text-right">
                        <a href={`/print/purchase-orders/${po.id}`} target="_blank" rel="noreferrer" aria-label={`Print ${po.number}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"><Printer className="h-4 w-4" /></a>
                        {canEdit && po.state === "NOT_RECEIVED" && po.receipts === 0 && <Button size="icon" variant="ghost" aria-label={`Edit ${po.number}`} onClick={() => setEditing(po)}><Pencil /></Button>}
                        {canReceive && po.state !== "CANCELLED" && po.state !== "RECEIVED" && <Button size="sm" variant="outline" onClick={() => setReceiving(po)}><PackageCheck /> Receive</Button>}
                        {canEdit && po.state === "NOT_RECEIVED" && po.receipts === 0 && <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Cancel ${po.number}`} onClick={() => void cancel(po)}><XCircle /></Button>}
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20"><td /><td colSpan={8} className="px-3 pb-3">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Material</th><th className="text-right font-medium">Ordered</th><th className="text-right font-medium">Received</th><th className="text-right font-medium">Unit price</th></tr></thead>
                          <tbody>{po.lines.map((l) => (
                            <tr key={l.id} className="border-t border-border/60"><td className="py-1.5">{l.description}{l.spec && <span className="text-muted-foreground"> · {l.spec}</span>}</td><td className="text-right tabular-nums">{num(l.orderedQty)} {l.unit}</td><td className="text-right tabular-nums">{num(l.receivedQty)} {l.unit}</td><td className="text-right tabular-nums">{l.unitPrice != null ? money(l.unitPrice, po.currency) : "—"}</td></tr>
                          ))}</tbody>
                        </table>
                        {(po.paymentTerms || po.notes) && <p className="mt-2 text-xs text-muted-foreground">{[po.paymentTerms && `Payment: ${parseTerms(po.paymentTerms).join("; ")}`, po.notes].filter(Boolean).join(" · ")}</p>}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewOrderDialog suppliers={suppliers.filter((s) => s.active)} projects={projects} onClose={() => setCreating(false)} />}
      {receiving && <ReceiveDialog po={receiving} onClose={() => setReceiving(null)} />}
      {editing && <EditOrderDialog po={editing} suppliers={suppliers.filter((s) => s.active || s.id === editing.supplier.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ new PO

function NewOrderDialog({ suppliers, projects, onClose }: { suppliers: SupplierDTO[]; projects: ProjectOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState("");
  const [supplierId, setSupplierId] = React.useState("");
  const [orderDate, setOrderDate] = React.useState(today());
  const [expectedDate, setExpectedDate] = React.useState("");
  const [terms, setTerms] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<ToOrder[] | null>(null);
  const [pick, setPick] = React.useState<Record<string, { on: boolean; qty: string; price: string }>>({});
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function load(id: string) {
    setProjectId(id); setItems(null);
    if (!id) return;
    setLoading(true);
    try {
      const rows = await api<ToOrder[]>(`/api/procurement/to-order?projectId=${id}`);
      setItems(rows);
      setPick(Object.fromEntries(rows.map((r) => [r.materialId, { on: true, qty: String(r.remaining), price: "" }])));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load the materials"); } finally { setLoading(false); }
  }
  const chosen = (items ?? []).filter((m) => pick[m.materialId]?.on && Number(pick[m.materialId].qty) > 0);

  async function create() {
    setBusy(true);
    try {
      const po = await api<PurchaseOrderDTO>("/api/purchase-orders", {
        method: "POST",
        body: {
          projectId, supplierId, orderDate, expectedDate: expectedDate || null, paymentTerms: joinTerms(terms), notes: notes || null,
          lines: chosen.map((m) => ({ materialId: m.materialId, qty: Number(pick[m.materialId].qty), unitPrice: pick[m.materialId].price === "" ? null : Number(pick[m.materialId].price) })),
        },
      });
      toast.success(`${po.number} created`);
      onClose();
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the purchase order"); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>New purchase order</DialogTitle><DialogDescription>Pick the project, then the materials it still needs to order. The lines appear in the project&apos;s Materials with this PO number.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project"><select className={selectClass} value={projectId} onChange={(e) => void load(e.target.value)}><option value="">Choose a project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} — {p.name}</option>)}</select></Field>
          <Field label="Supplier"><select className={selectClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose a supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Order date"><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
          <Field label="Expected delivery"><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
          <div className="sm:col-span-2"><TermsEditor terms={terms} onChange={setTerms} /></div>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading materials…</p>}
        {items && (items.length === 0 ? <Empty text="Everything this project needs is already ordered." /> : (
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur"><tr><Th /><Th>Material</Th><Th right>Still to order</Th><Th right>Quantity</Th><Th right>Unit price</Th></tr></thead>
              <tbody className="divide-y divide-border">{items.map((m) => {
                const p = pick[m.materialId];
                return (
                  <tr key={m.materialId}>
                    <Td className="w-8"><input type="checkbox" aria-label={`Include ${m.description}`} checked={p?.on ?? false} onChange={(e) => setPick((s) => ({ ...s, [m.materialId]: { ...s[m.materialId], on: e.target.checked } }))} /></Td>
                    <Td>{m.description}{m.spec && <p className="text-xs text-muted-foreground">{m.spec}</p>}</Td>
                    <Td right>{num(m.remaining)} {m.unit}</Td>
                    <Td right><Input type="number" min={0} step="any" className="ml-auto h-8 w-28 text-right" value={p?.qty ?? ""} onChange={(e) => setPick((s) => ({ ...s, [m.materialId]: { ...s[m.materialId], qty: e.target.value } }))} /></Td>
                    <Td right><Input type="number" min={0} step="any" className="ml-auto h-8 w-28 text-right" value={p?.price ?? ""} placeholder="—" onChange={(e) => setPick((s) => ({ ...s, [m.materialId]: { ...s[m.materialId], price: e.target.value } }))} /></Td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || !projectId || !supplierId || chosen.length === 0}>{busy && <Loader2 className="animate-spin" />} Create PO ({chosen.length} line{chosen.length === 1 ? "" : "s"})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------ receive

function ReceiveDialog({ po, onClose }: { po: PurchaseOrderDTO; onClose: () => void }) {
  const router = useRouter();
  const open = po.lines.filter((l) => l.receivedQty < l.orderedQty);
  const [date, setDate] = React.useState(today());
  const [note, setNote] = React.useState("");
  const [rows, setRows] = React.useState<Record<string, { qty: string; ok: boolean; heat: string; cert: string }>>(() => Object.fromEntries(open.map((l) => [l.id, { qty: "", ok: true, heat: "", cert: "" }])));
  const [busy, setBusy] = React.useState(false);
  const set = (id: string, patch: Partial<{ qty: string; ok: boolean; heat: string; cert: string }>) => setRows((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const filled = open.filter((l) => Number(rows[l.id]?.qty) > 0);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${po.id}/receipts`, {
        method: "POST",
        body: { receivedDate: date, deliveryNote: note || null, lines: filled.map((l) => ({ orderId: l.id, qty: Number(rows[l.id].qty), accepted: rows[l.id].ok, heatNo: rows[l.id].heat || null, certificateRef: rows[l.id].cert || null })) },
      });
      toast.success("Goods received");
      onClose();
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not record the receipt"); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Receive goods — {po.number}</DialogTitle><DialogDescription>{po.supplier.name} · enter what actually arrived, with the heat number and mill certificate of the steel. A delivery may exceed the open quantity by up to {OVER_RECEIPT_TOLERANCE_PCT}%.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Received on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Supplier delivery note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur"><tr><Th>Material</Th><Th right>Open</Th><Th right>Received</Th><Th>Heat no.</Th><Th>MTC no.</Th><Th>OK</Th></tr></thead>
            <tbody className="divide-y divide-border">{open.map((l) => (
              <tr key={l.id}>
                <Td>{l.description}{l.spec && <p className="text-xs text-muted-foreground">{l.spec}</p>}</Td>
                <Td right>{num(receiptLimit(l.orderedQty, l.receivedQty, 0))} {l.unit}</Td>
                <Td right><Input type="number" min={0} step="any" className="ml-auto h-8 w-24 text-right" value={rows[l.id].qty} onChange={(e) => set(l.id, { qty: e.target.value })} /></Td>
                <Td><Input className="h-8 w-28" value={rows[l.id].heat} onChange={(e) => set(l.id, { heat: e.target.value })} /></Td>
                <Td><Input className="h-8 w-28" value={rows[l.id].cert} onChange={(e) => set(l.id, { cert: e.target.value })} /></Td>
                <Td><input type="checkbox" aria-label={`${l.description} accepted`} checked={rows[l.id].ok} onChange={(e) => set(l.id, { ok: e.target.checked })} /></Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Untick “OK” for steel you reject: it is recorded but does not count as received.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || filled.length === 0}>{busy && <Loader2 className="animate-spin" />} Record receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ------------------------------------------------------------------------------------------ edit PO (before anything is received)

function EditOrderDialog({ po, suppliers, onClose }: { po: PurchaseOrderDTO; suppliers: SupplierDTO[]; onClose: () => void }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = React.useState(po.supplier.id);
  const [orderDate, setOrderDate] = React.useState(po.orderDate.slice(0, 10));
  const [expectedDate, setExpectedDate] = React.useState(po.expectedDate?.slice(0, 10) ?? "");
  const [terms, setTerms] = React.useState<string[]>(parseTerms(po.paymentTerms));
  const [notes, setNotes] = React.useState(po.notes ?? "");
  const [lines, setLines] = React.useState(po.lines.map((l) => ({ id: l.id, on: true, qty: String(l.orderedQty), price: l.unitPrice != null ? String(l.unitPrice) : "" })));
  const [busy, setBusy] = React.useState(false);
  const set = (id: string, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const kept = lines.filter((l) => l.on && Number(l.qty) > 0);
  // lines added while editing: one at a time, from the project's materials that still have something left to order
  const [avail, setAvail] = React.useState<ToOrder[]>([]);
  const [added, setAdded] = React.useState<{ key: string; materialId: string; qty: string; price: string }[]>([]);
  const [pick, setPick] = React.useState("");
  React.useEffect(() => { api<ToOrder[]>(`/api/procurement/to-order?projectId=${po.project.id}`).then(setAvail).catch(() => setAvail([])); }, [po.project.id]);
  const left = avail.filter((m) => !added.some((a) => a.materialId === m.materialId));
  const matOf = (id: string) => avail.find((m) => m.materialId === id);
  const addLine = () => {
    const m = left.find((x) => x.materialId === pick) ?? left[0];
    if (!m) return;
    setAdded((a) => [...a, { key: `${m.materialId}-${a.length}`, materialId: m.materialId, qty: String(m.remaining), price: "" }]);
    setPick("");
  };
  const addedOk = added.filter((a) => Number(a.qty) > 0);
  // free items (not in the project's Materials yet): typed in by hand
  const [custom, setCustom] = React.useState<{ key: string; description: string; unit: string; qty: string; price: string }[]>([]);
  const customOk = custom.filter((c) => c.description.trim().length >= 2 && Number(c.qty) > 0 && c.unit.trim());
  const upC = (key: string, patch: Partial<(typeof custom)[number]>) => setCustom((x) => x.map((y) => (y.key === key ? { ...y, ...patch } : y)));
  const total = kept.length + addedOk.length + customOk.length;

  async function save() {
    if (!total) return toast.error("Keep at least one line, or cancel the order instead");
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        body: { supplierId, orderDate, expectedDate: expectedDate || null, paymentTerms: joinTerms(terms), notes: notes || null, lines: [...kept.map((l) => ({ id: l.id, qty: Number(l.qty), unitPrice: l.price.trim() === "" ? null : Number(l.price) })), ...addedOk.map((a) => ({ materialId: a.materialId, qty: Number(a.qty), unitPrice: a.price.trim() === "" ? null : Number(a.price) })), ...customOk.map((c) => ({ custom: { description: c.description.trim(), unit: c.unit.trim() }, qty: Number(c.qty), unitPrice: c.price.trim() === "" ? null : Number(c.price) }))] },
      });
      toast.success(`${po.number} updated`);
      router.refresh();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the changes"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Edit {po.number}</DialogTitle><DialogDescription>You can change the order until goods are received against it. Print it again after saving.</DialogDescription></DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier"><select className={selectClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Order date"><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
            <Field label="Expected delivery"><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
            <div className="sm:col-span-2"><TermsEditor terms={terms} onChange={setTerms} /></div>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} /></Field>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50"><tr><Th /><Th>Material</Th><Th right>Qty</Th><Th right>Unit price ({po.currency})</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {po.lines.map((pl) => {
                  const l = lines.find((x) => x.id === pl.id)!;
                  return (
                    <tr key={pl.id} className={l.on ? "" : "opacity-50"}>
                      <Td className="w-8"><input type="checkbox" checked={l.on} onChange={(e) => set(pl.id, { on: e.target.checked })} aria-label={`Keep ${pl.description}`} /></Td>
                      <Td>{pl.description}{pl.spec && <span className="text-muted-foreground"> · {pl.spec}</span>}</Td>
                      <Td right><div className="ml-auto flex w-36 items-center gap-1.5"><Input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(pl.id, { qty: e.target.value })} className="h-9 text-right" /><span className="w-10 text-left text-xs text-muted-foreground">{pl.unit}</span></div></Td>
                      <Td right><Input type="number" min={0} step="any" placeholder="—" value={l.price} onChange={(e) => set(pl.id, { price: e.target.value })} className="ml-auto h-9 w-32 text-right" /></Td>
                    </tr>
                  );
                })}
                {added.map((a) => {
                  const m = matOf(a.materialId);
                  return (
                    <tr key={a.key} className="bg-primary/5">
                      <Td className="w-8"><button type="button" aria-label="Remove added line" className="text-destructive" onClick={() => setAdded((x) => x.filter((y) => y.key !== a.key))}><XCircle className="h-4 w-4" /></button></Td>
                      <Td>{m?.description ?? "Material"}{m?.spec && <span className="text-muted-foreground"> · {m.spec}</span>}<span className="ml-2 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">NEW</span></Td>
                      <Td right><div className="ml-auto flex w-36 items-center gap-1.5"><Input type="number" min={0} step="any" value={a.qty} onChange={(e) => setAdded((x) => x.map((y) => (y.key === a.key ? { ...y, qty: e.target.value } : y)))} className="h-9 text-right" /><span className="w-10 text-left text-xs text-muted-foreground">{m?.unit}</span></div></Td>
                      <Td right><Input type="number" min={0} step="any" placeholder="—" value={a.price} onChange={(e) => setAdded((x) => x.map((y) => (y.key === a.key ? { ...y, price: e.target.value } : y)))} className="ml-auto h-9 w-32 text-right" /></Td>
                    </tr>
                  );
                })}
                {custom.map((c) => (
                  <tr key={c.key} className="bg-primary/5">
                    <Td className="w-8"><button type="button" aria-label="Remove item" className="text-destructive" onClick={() => setCustom((x) => x.filter((y) => y.key !== c.key))}><XCircle className="h-4 w-4" /></button></Td>
                    <Td><Input value={c.description} onChange={(e) => upC(c.key, { description: e.target.value })} placeholder="Item description (e.g. Welding electrodes E7018)" maxLength={200} className="h-9" /></Td>
                    <Td right><div className="ml-auto flex w-36 items-center gap-1.5"><Input type="number" min={0} step="any" value={c.qty} onChange={(e) => upC(c.key, { qty: e.target.value })} className="h-9 text-right" /><Input value={c.unit} onChange={(e) => upC(c.key, { unit: e.target.value })} maxLength={20} aria-label="Unit" className="h-9 w-14 px-1.5 text-xs" /></div></Td>
                    <Td right><Input type="number" min={0} step="any" placeholder="—" value={c.price} onChange={(e) => upC(c.key, { price: e.target.value })} className="ml-auto h-9 w-32 text-right" /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass + " max-w-sm"} value={pick} onChange={(e) => setPick(e.target.value)} disabled={!left.length}>
              <option value="">{left.length ? "Choose a material to add…" : "No other materials left to order"}</option>
              {left.map((m) => <option key={m.materialId} value={m.materialId}>{m.description}{m.spec ? ` · ${m.spec}` : ""} — {num(m.remaining)} {m.unit} left</option>)}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={addLine} disabled={!left.length}><Plus /> Add line</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCustom((x) => [...x, { key: `c${Date.now()}${x.length}`, description: "", unit: "pcs", qty: "1", price: "" }])}><Plus /> Add new item</Button>
          </div>
          <p className="text-xs text-muted-foreground">Untick a line to remove it from this order (its quantity goes back to &ldquo;still to order&rdquo;), add more lines from the project&rsquo;s materials, or type a new item with <b>Add new item</b> (it is also added to the project&rsquo;s Materials).</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !total}>{busy ? <Loader2 className="animate-spin" /> : <Pencil />} Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
