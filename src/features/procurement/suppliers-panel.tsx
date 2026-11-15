"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SupplierDTO } from "@/server/services/suppliers.service";
import { api, Empty, Field, Pill, Td, Th } from "./ui";

type Draft = { name: string; contactName: string; phone: string; email: string; address: string; notes: string; active: boolean };
const blank: Draft = { name: "", contactName: "", phone: "", email: "", address: "", notes: "", active: true };

export function SuppliersPanel({ suppliers, canEdit }: { suppliers: SupplierDTO[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const open = (s?: SupplierDTO) => setEditing({ id: s?.id ?? null, draft: s ? { name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", notes: s.notes ?? "", active: s.active } : blank });
  const set = (k: keyof Draft, v: string | boolean) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await api(editing.id ? `/api/suppliers/${editing.id}` : "/api/suppliers", { method: editing.id ? "PUT" : "POST", body: editing.draft });
      toast.success(editing.id ? "Supplier updated" : "Supplier added");
      setEditing(null);
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  async function remove(s: SupplierDTO) {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    try { await api(`/api/suppliers/${s.id}`, { method: "DELETE" }); toast.success("Supplier deleted"); router.refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{canEdit && <Button onClick={() => open()}><Plus /> Add supplier</Button>}</div>
      {suppliers.length === 0 ? <Empty text="No suppliers yet. Add the companies you buy steel from." /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50"><tr><Th>Supplier</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th right>Orders</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <Td className="font-medium">{s.name}{s.address && <p className="text-xs font-normal text-muted-foreground">{s.address}</p>}</Td>
                  <Td>{s.contactName ?? "—"}</Td><Td>{s.phone ?? "—"}</Td><Td>{s.email ?? "—"}</Td>
                  <Td right>{s.orders}</Td>
                  <Td>{s.active ? <Pill tone="good">Active</Pill> : <Pill tone="muted">Inactive</Pill>}</Td>
                  <Td className="text-right">
                    {canEdit && (<>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => open(s)}><Pencil /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} className="text-destructive" onClick={() => void remove(s)}><Trash2 /></Button>
                    </>)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && !busy && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit supplier" : "Add supplier"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2"><Input value={editing.draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Contact person"><Input value={editing.draft.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
              <Field label="Phone"><Input value={editing.draft.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Email" className="sm:col-span-2"><Input type="email" value={editing.draft.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Address" className="sm:col-span-2"><Input value={editing.draft.address} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={editing.draft.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
              {editing.id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={editing.draft.active} onChange={(e) => set("active", e.target.checked)} /> Active (can receive new purchase orders)</label>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !editing?.draft.name.trim()}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
