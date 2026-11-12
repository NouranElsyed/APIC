"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { planApi } from "./api";
import type { MaterialDTO, OrderDTO } from "./materials";
import type { MaterialsData } from "@/server/services/materials.service";

const selectCls = "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}

// -------------------------------------------------------------------------- material
function MaterialForm({ onOpenChange, projectId, data, material }: { onOpenChange: (o: boolean) => void; projectId: string; data: MaterialsData; material: MaterialDTO | null }) {
  const router = useRouter();
  const isEdit = !!material;
  const [f, setF] = React.useState({
    description: material?.description ?? "", code: material?.code ?? "", spec: material?.spec ?? "", unit: material?.unit ?? "kg",
    requiredQty: material ? String(material.requiredQty) : "", wbsId: material?.wbsId ?? "", activityId: material?.activityId ?? "",
    neededBy: material?.neededBySource === "manual" ? material.neededBy ?? "" : "", notes: material?.notes ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const linked = data.activityOptions.find((a) => a.id === f.activityId);

  async function submit() {
    const qty = num(f.requiredQty);
    if (!Number.isFinite(qty) || qty < 0) return void toast.error("Enter the required quantity.");
    setBusy(true);
    const body = { description: f.description, code: f.code || null, spec: f.spec || null, unit: f.unit || "kg", requiredQty: qty, wbsId: f.wbsId || null, activityId: f.activityId || null, neededBy: f.neededBy || null, notes: f.notes || null };
    const r = await planApi(isEdit ? `/api/projects/${projectId}/materials/${material!.id}` : `/api/projects/${projectId}/materials`, { method: isEdit ? "PATCH" : "POST", body });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(isEdit ? "Material updated" : "Material added");
    onOpenChange(false);
    router.refresh();
  }
  async function remove() {
    if (!material || !confirm(`Delete "${material.description}" and its ${material.orders.length} order(s)?`)) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/materials/${material.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{isEdit ? "Edit material" : "Add material"}</DialogTitle><DialogDescription>What the project needs, which phase uses it, and when it must be on site.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => set("description", e.target.value)} autoFocus placeholder="e.g. Riser duct plate" /></Field>
        <Field label="Item code"><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="optional" /></Field>
        <Field label="Spec / grade" className="sm:col-span-3"><Input value={f.spec} onChange={(e) => set("spec", e.target.value)} placeholder="e.g. ST37 · 6 mm" /></Field>
        <Field label="Required quantity"><Input type="number" min={0} step="any" value={f.requiredQty} onChange={(e) => set("requiredQty", e.target.value)} /></Field>
        <Field label="Unit"><Input value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="kg, m, pcs…" /></Field>
        <Field label="Needed on site by"><Input type="date" value={f.neededBy} onChange={(e) => set("neededBy", e.target.value)} /></Field>
        <Field label="Phase (WBS)" className="sm:col-span-3">
          <select className={selectCls} value={f.wbsId} onChange={(e) => set("wbsId", e.target.value)}>
            <option value="">— no phase —</option>
            {data.wbsOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </Field>
        <Field label="Needed for activity (optional)" className="sm:col-span-3">
          <select className={selectCls} value={f.activityId} onChange={(e) => set("activityId", e.target.value)}>
            <option value="">— none —</option>
            {data.activityOptions.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
          {linked && !f.neededBy && <p className="mt-1 text-[11px] text-muted-foreground">Needed-by follows the start date of {linked.code} and moves when the schedule changes.</p>}
        </Field>
        <Field label="Notes" className="sm:col-span-3"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <DialogFooter className="sm:justify-between">
        {isEdit ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || !f.description.trim() || f.requiredQty === ""}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save" : "Add"}</Button></div>
      </DialogFooter>
    </DialogContent>
  );
}
export function MaterialDialog(props: React.ComponentProps<typeof MaterialForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <MaterialForm key={rest.material?.id ?? "new"} {...rest} />}</Dialog>;
}

// ----------------------------------------------------------------------------- order
function OrderForm({ onOpenChange, projectId, data, material, order }: { onOpenChange: (o: boolean) => void; projectId: string; data: MaterialsData; material: MaterialDTO; order: OrderDTO | null }) {
  const router = useRouter();
  const isEdit = !!order;
  const [f, setF] = React.useState({
    supplier: order?.supplier ?? "", poNumber: order?.poNumber ?? "", orderedQty: String(order?.orderedQty ?? (material.toOrder || material.requiredQty)),
    unitPrice: order?.unitPrice != null ? String(order.unitPrice) : "", orderDate: order?.orderDate ?? today(), expectedDate: order?.expectedDate ?? "",
    receivedQty: String(order?.receivedQty ?? 0), receivedDate: order?.receivedDate ?? "", notes: order?.notes ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    const ordered = num(f.orderedQty);
    const received = f.receivedQty === "" ? 0 : num(f.receivedQty);
    if (!Number.isFinite(ordered) || ordered <= 0) return void toast.error("Enter the ordered quantity.");
    if (!Number.isFinite(received) || received < 0 || received > ordered) return void toast.error("Received quantity must be between 0 and the ordered quantity.");
    setBusy(true);
    const body = {
      supplier: f.supplier, poNumber: f.poNumber || null, orderedQty: ordered, unitPrice: f.unitPrice === "" ? null : num(f.unitPrice),
      orderDate: f.orderDate || null, expectedDate: f.expectedDate || null, receivedQty: received, receivedDate: f.receivedDate || null, notes: f.notes || null,
    };
    const base = `/api/projects/${projectId}/materials/${material.id}/orders`;
    const r = await planApi(isEdit ? `${base}/${order!.id}` : base, { method: isEdit ? "PATCH" : "POST", body });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(isEdit ? "Order updated" : "Purchase order added");
    onOpenChange(false);
    router.refresh();
  }
  async function remove() {
    if (!order || !confirm("Delete this purchase order?")) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/materials/${material.id}/orders/${order.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{isEdit ? "Edit purchase order" : "New purchase order"}</DialogTitle><DialogDescription>{material.description}{material.spec ? ` · ${material.spec}` : ""} — required {material.requiredQty} {material.unit}, already ordered {material.orderedQty - (order?.orderedQty ?? 0)}.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier">
          <Input list="supplier-names" value={f.supplier} onChange={(e) => set("supplier", e.target.value)} autoFocus placeholder="Where it is bought from" />
          <datalist id="supplier-names">{data.supplierNames.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="PO number"><Input value={f.poNumber} onChange={(e) => set("poNumber", e.target.value)} /></Field>
        <Field label={`Ordered quantity (${material.unit})`}><Input type="number" min={0} step="any" value={f.orderedQty} onChange={(e) => set("orderedQty", e.target.value)} /></Field>
        <Field label={`Unit price (per ${material.unit})`}><Input type="number" min={0} step="any" value={f.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="optional" /></Field>
        <Field label="Order date"><Input type="date" value={f.orderDate} onChange={(e) => set("orderDate", e.target.value)} /></Field>
        <Field label="Expected delivery"><Input type="date" value={f.expectedDate} onChange={(e) => set("expectedDate", e.target.value)} /></Field>
        <Field label={`Received so far (${material.unit})`}><Input type="number" min={0} step="any" value={f.receivedQty} onChange={(e) => set("receivedQty", e.target.value)} /></Field>
        <Field label="Last received on"><Input type="date" value={f.receivedDate} onChange={(e) => set("receivedDate", e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <DialogFooter className="sm:justify-between">
        {isEdit ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || !f.supplier.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save" : "Add order"}</Button></div>
      </DialogFooter>
    </DialogContent>
  );
}
export function OrderDialog(props: React.ComponentProps<typeof OrderForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <OrderForm key={rest.order?.id ?? "new" + rest.material.id} {...rest} />}</Dialog>;
}

// ---------------------------------------------------------------------------- receive
function ReceiveForm({ onOpenChange, projectId, material, order }: { onOpenChange: (o: boolean) => void; projectId: string; material: MaterialDTO; order: OrderDTO }) {
  const router = useRouter();
  const remaining = Math.max(0, order.orderedQty - order.receivedQty);
  const [qty, setQty] = React.useState(String(remaining));
  const [date, setDate] = React.useState(today());
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    const q = num(qty);
    if (!Number.isFinite(q) || q <= 0) return void toast.error("Enter the quantity that arrived.");
    if (q > remaining + 1e-9) return void toast.error(`Only ${remaining} ${material.unit} are still outstanding on this order.`);
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/materials/${material.id}/orders/${order.id}`, {
      method: "PATCH",
      body: { supplier: order.supplier, poNumber: order.poNumber, orderedQty: order.orderedQty, unitPrice: order.unitPrice, orderDate: order.orderDate, expectedDate: order.expectedDate, notes: order.notes, receivedQty: order.receivedQty + q, receivedDate: date },
    });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Recorded ${q} ${material.unit} received`);
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Record delivery</DialogTitle><DialogDescription>{material.description} · {order.supplier}{order.poNumber ? ` · ${order.poNumber}` : ""}<br />Ordered {order.orderedQty}, received {order.receivedQty}, outstanding {remaining} {material.unit}.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Quantity received now (${material.unit})`}><Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <Field label="Received on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save delivery</Button></DialogFooter>
    </DialogContent>
  );
}
export function ReceiveDialog(props: React.ComponentProps<typeof ReceiveForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <ReceiveForm key={rest.order.id} {...rest} />}</Dialog>;
}

// ----------------------------------------------------------------------------- import
function ImportForm({ onOpenChange, projectId }: { onOpenChange: (o: boolean) => void; projectId: string }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<{ created: number; warnings: string[] } | null>(null);
  async function submit() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials/import`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(json?.error ?? "Import failed");
      else { setReport(json); router.refresh(); }
    } catch { toast.error("Network error — please try again."); }
    setBusy(false);
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Import materials from Excel</DialogTitle><DialogDescription>Adds rows to the list (nothing is overwritten). Columns: Description, Quantity, Unit, Spec, Phase, Activity ID, Needed by.</DialogDescription></DialogHeader>
      {report ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-green-700">Imported {report.created} materials.</p>
          {report.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-6 text-xs text-amber-800">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center hover:bg-secondary/50">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choose an .xlsx file"}</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-muted-foreground">Not sure about the layout? <a className="text-primary underline" href={`/api/projects/${projectId}/materials/export?format=template`}>Download the template</a>.</p>
          <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!file || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Import</Button></DialogFooter>
        </div>
      )}
    </DialogContent>
  );
}
export function ImportMaterialsDialog(props: React.ComponentProps<typeof ImportForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <ImportForm {...rest} />}</Dialog>;
}
