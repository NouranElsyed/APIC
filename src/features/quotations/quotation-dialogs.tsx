"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { planApi } from "@/features/planning/api";
import { addDays, daysBetween } from "./quotation";
import type { QuotationRowDTO } from "./dto";

const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}

// ------------------------------------------------------------------ create / edit header
export interface QuotationFormValues { id: string; section: string | null; description: string; currency: string; issueDate: string; validUntil: string | null; profitMargin: number | null; preparedBy: string | null }

function Form({ projectId, onOpenChange, quotation, onSaved }: { projectId: string; onOpenChange: (o: boolean) => void; quotation: QuotationFormValues | null; onSaved?: (id: string) => void }) {
  const router = useRouter();
  const isEdit = !!quotation;
  const [f, setF] = React.useState({
    section: quotation?.section ?? "", description: quotation?.description ?? "", currency: quotation?.currency ?? "EGP",
    issueDate: quotation?.issueDate ?? today(), validDays: quotation?.validUntil ? String(daysBetween(quotation.issueDate, quotation.validUntil)) : "30",
    profitMargin: quotation?.profitMargin != null ? String(quotation.profitMargin) : "", preparedBy: quotation?.preparedBy ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    const days = Number(f.validDays);
    if (!Number.isFinite(days) || days < 0) return void toast.error("Validity must be a number of days.");
    const margin = f.profitMargin.trim() === "" ? null : Number(f.profitMargin);
    if (margin !== null && !Number.isFinite(margin)) return void toast.error("Profit margin must be a number.");
    setBusy(true);
    const body = { section: f.section || null, description: f.description, currency: f.currency || "EGP", issueDate: f.issueDate, validUntil: addDays(f.issueDate, days), profitMargin: margin, preparedBy: f.preparedBy || null };
    const url = `/api/projects/${projectId}/quotations${isEdit ? `/${quotation!.id}` : ""}`;
    const r = await planApi<{ id?: string }>(url, { method: isEdit ? "PATCH" : "POST", body });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(isEdit ? "Quotation updated" : "Quotation created");
    onOpenChange(false);
    const id = isEdit ? quotation!.id : r.data.id!;
    if (!isEdit) router.push(`/projects/${projectId}/quotations/${id}`); else router.refresh();
    onSaved?.(id);
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{isEdit ? "Edit quotation" : "New quotation"}</DialogTitle><DialogDescription>{isEdit ? "Header details. Edit the BOQ items from the quotation page." : "Create the quotation, then add its BOQ items on the next screen."}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => set("description", e.target.value)} autoFocus placeholder="e.g. Riser duct steel fabrication" /></Field>
        <Field label="Project section"><Input value={f.section} onChange={(e) => set("section", e.target.value)} placeholder="Steel Structure, Ducts…" /></Field>
        <Field label="Prepared by"><Input value={f.preparedBy} onChange={(e) => set("preparedBy", e.target.value)} placeholder="defaults to you" /></Field>
        <Field label="Issue date"><Input type="date" value={f.issueDate} onChange={(e) => set("issueDate", e.target.value)} /></Field>
        <Field label="Valid for (days)"><Input type="number" min={0} value={f.validDays} onChange={(e) => set("validDays", e.target.value)} /></Field>
        <Field label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={6} /></Field>
        <Field label="Profit margin (%)"><Input type="number" step="any" value={f.profitMargin} onChange={(e) => set("profitMargin", e.target.value)} placeholder="optional" /></Field>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || !f.description.trim() || !f.issueDate}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save" : "Create"}</Button></DialogFooter>
    </DialogContent>
  );
}
export function QuotationFormDialog(props: React.ComponentProps<typeof Form> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <Form key={rest.quotation?.id ?? "new"} {...rest} />}</Dialog>;
}

export const toFormValues = (q: QuotationRowDTO & { profitMargin?: number | null; preparedBy?: string | null }): QuotationFormValues =>
  ({ id: q.id, section: q.section, description: q.description, currency: q.currency, issueDate: q.issueDate, validUntil: q.validUntil, profitMargin: q.profitMargin ?? null, preparedBy: q.preparedBy ?? null });

// ------------------------------------------------------------------------------ import
function ImportForm({ onOpenChange, projectId }: { onOpenChange: (o: boolean) => void; projectId: string }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<{ id: string; number: string; created: number; warnings: string[] } | null>(null);
  async function submit() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/projects/${projectId}/quotations/import`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(json?.error ?? "Import failed");
      else { setReport(json); router.refresh(); }
    } catch { toast.error("Network error — please try again."); }
    setBusy(false);
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Import BOQ from Excel</DialogTitle><DialogDescription>Creates a new draft quotation from the first sheet. Columns: Item Description, Material, Qty, Unit, Unit Rate, Type.</DialogDescription></DialogHeader>
      {report ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-green-700">Created {report.number} with {report.created} items.</p>
          {report.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-6 text-xs text-amber-800">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button onClick={() => router.push(`/projects/${projectId}/quotations/${report.id}`)}>Open quotation</Button></DialogFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center hover:bg-secondary/50">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choose an .xlsx file"}</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-muted-foreground">Not sure about the layout? <a className="text-primary underline" href={`/api/projects/${projectId}/quotations/export?format=template`}>Download the template</a>.</p>
          <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!file || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Import</Button></DialogFooter>
        </div>
      )}
    </DialogContent>
  );
}
export function ImportQuotationDialog(props: React.ComponentProps<typeof ImportForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <ImportForm {...rest} />}</Dialog>;
}
