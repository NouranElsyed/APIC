"use client";
import * as React from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, ListTree, Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { BoqData, GroupRowDTO } from "@/server/services/part-group.service";
import type { TakeoffDrawingRow, TakeoffPartRow } from "./types";

const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const NO_PARENT = "__none__";

async function errorOf(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

// ------------------------------------------------------------------------------------------------ group form

function GroupForm({ open, onOpenChange, projectId, editing, groups, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string;
  editing: GroupRowDTO | null; groups: GroupRowDTO[]; onSaved: () => void;
}) {
  const [f, setF] = React.useState({ code: "", name: "", dwgNo: "", qty: "1", remark: "", parentId: NO_PARENT });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setF(editing
      ? { code: editing.code, name: editing.name, dwgNo: editing.dwgNo ?? "", qty: String(editing.qty), remark: editing.remark ?? "", parentId: editing.parentId ?? NO_PARENT }
      : { code: "", name: "", dwgNo: "", qty: "1", remark: "", parentId: NO_PARENT });
  }, [open, editing]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  // a group cannot become a child of itself or of its own descendants
  const descendants = React.useMemo(() => {
    const out = new Set<string>();
    if (!editing) return out;
    out.add(editing.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of groups) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) { out.add(g.id); grew = true; }
    }
    return out;
  }, [editing, groups]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(f.qty);
    if (!f.code.trim() || !f.name.trim() || !Number.isInteger(qty) || qty < 0) { toast.error("Code, name and a whole-number quantity are required"); return; }
    setBusy(true);
    const res = await fetch(editing ? `/api/part-groups/${editing.id}` : "/api/part-groups", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId, code: f.code.trim(), name: f.name.trim(), dwgNo: f.dwgNo.trim() || null, qty,
        remark: f.remark.trim() || null, parentId: f.parentId === NO_PARENT ? null : f.parentId,
      }),
    });
    setBusy(false);
    if (!res.ok) { toast.error(await errorOf(res, "Failed to save assembly")); return; }
    const body = await res.json().catch(() => null);
    toast.success(editing ? `Assembly updated${body?.partsUpdated ? ` — ${body.partsUpdated} part quantities recalculated` : ""}` : "Assembly created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Assembly" : "New Assembly"}</DialogTitle>
          <DialogDescription>Without a parent the quantity is the number of assemblies; inside a parent it is the number per parent assembly.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Code</Label><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="0515-1" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Gable Wall" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Drawing no. (optional)</Label><Input value={f.dwgNo} onChange={(e) => set("dwgNo", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Qty</Label><Input type="number" min={0} value={f.qty} onChange={(e) => set("qty", e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Inside assembly</Label>
              <Select value={f.parentId} onValueChange={(v) => set("parentId", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>— none (top level) —</SelectItem>
                  {groups.filter((g) => !descendants.has(g.id)).map((g) => <SelectItem key={g.id} value={g.id}>{g.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Remark (optional)</Label><Input value={f.remark} onChange={(e) => set("remark", e.target.value)} placeholder="e.g. Assembly in 0518" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ assign parts

function AssignDialog({ open, onOpenChange, projectId, group, groups, drawings, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string;
  group: GroupRowDTO | null; groups: GroupRowDTO[]; drawings: TakeoffDrawingRow[]; onDone: () => void;
}) {
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [perAsm, setPerAsm] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (open) { setPicked(new Set()); setPerAsm(""); setSearch(""); } }, [open, group?.id]);

  const codeOf = React.useMemo(() => new Map(groups.map((g) => [g.id, g.code])), [groups]);
  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const all: { part: TakeoffPartRow; dwg: string }[] = drawings.flatMap((d) => d.parts.map((part) => ({ part, dwg: d.drawingNumber })));
    return all
      .filter(({ part, dwg }) => part.groupId !== group?.id && (!q || `${dwg} ${part.itemNo} ${part.description}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!a.part.groupId) - Number(!!b.part.groupId)); // ungrouped first
  }, [drawings, group?.id, search]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit() {
    if (!group || picked.size === 0) return;
    const per = perAsm.trim() === "" ? undefined : Number(perAsm);
    if (per !== undefined && (!Number.isInteger(per) || per <= 0)) { toast.error("Qty per assembly must be a whole number above 0"); return; }
    setBusy(true);
    const res = await fetch("/api/part-groups/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, groupId: group.id, partIds: [...picked], qtyPerAssembly: per }),
    });
    setBusy(false);
    if (!res.ok) { toast.error(await errorOf(res, "Failed to add parts")); return; }
    const body = await res.json();
    toast.success(`${body.assigned} parts added to ${group.code}${body.quantityChanged?.length ? ` — ${body.quantityChanged.length} quantities adjusted` : ""}`);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add parts to {group?.code}</DialogTitle>
          <DialogDescription>
            Each part&apos;s total quantity becomes {group ? group.effectiveQty : 0} × its qty per assembly. Leave &quot;qty per assembly&quot; blank to keep the current quantity when it divides evenly.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5"><Label>Search</Label><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="drawing, item no., description…" /></div>
          <div className="w-40 space-y-1.5"><Label>Qty per assembly</Label><Input type="number" min={1} value={perAsm} onChange={(e) => setPerAsm(e.target.value)} placeholder="auto" /></div>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <tbody>
              {rows.length === 0 && <tr><td className="p-4 text-center text-muted-foreground">No parts to show.</td></tr>}
              {rows.map(({ part, dwg }) => (
                <tr key={part.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => toggle(part.id)}>
                  <td className="w-8 px-2 py-1.5"><input type="checkbox" checked={picked.has(part.id)} onChange={() => toggle(part.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dwg} #{part.itemNo}</td>
                  <td className="px-2 py-1.5">{part.description}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">× {part.qty}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{part.groupId ? `in ${codeOf.get(part.groupId) ?? "?"}` : "ungrouped"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || picked.size === 0}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add {picked.size || ""} parts</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ panel

export function BoqPanel({ projectId, drawings, canCreate, canDelete, refreshKey, onChanged }: {
  projectId: string; drawings: TakeoffDrawingRow[]; canCreate: boolean; canDelete: boolean;
  /** changes whenever the drawings were reloaded, so the weights here follow */
  refreshKey: unknown; onChanged: () => void;
}) {
  const [boq, setBoq] = React.useState<BoqData | null>(null);
  const [open, setOpen] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [form, setForm] = React.useState<{ open: boolean; editing: GroupRowDTO | null }>({ open: false, editing: null });
  const [assign, setAssign] = React.useState<GroupRowDTO | null>(null);
  const [deleting, setDeleting] = React.useState<GroupRowDTO | null>(null);
  const [delBusy, setDelBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/part-groups?projectId=${projectId}`);
    setBoq(res.ok ? await res.json() : null);
  }, [projectId]);
  React.useEffect(() => { load(); }, [load, refreshKey]);

  const changed = () => { load(); onChanged(); };

  // depth-first rows, honouring collapsed branches
  const rows = React.useMemo(() => {
    if (!boq) return [];
    const kids = new Map<string | null, GroupRowDTO[]>();
    const ids = new Set(boq.groups.map((g) => g.id));
    for (const g of boq.groups) {
      const key = g.parentId && ids.has(g.parentId) ? g.parentId : null;
      kids.set(key, [...(kids.get(key) ?? []), g]);
    }
    const out: { g: GroupRowDTO; depth: number; hasKids: boolean }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of kids.get(parent) ?? []) {
        out.push({ g, depth, hasKids: (kids.get(g.id) ?? []).length > 0 });
        if (!collapsed.has(g.id)) walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [boq, collapsed]);

  async function confirmDelete() {
    if (!deleting) return;
    setDelBusy(true);
    const res = await fetch(`/api/part-groups/${deleting.id}`, { method: "DELETE" });
    setDelBusy(false);
    if (!res.ok) { toast.error(await errorOf(res, "Failed to delete assembly")); return; }
    toast.success("Assembly deleted — its parts keep their quantities");
    setDeleting(null);
    changed();
  }

  async function ungroup(partId: string) {
    const res = await fetch("/api/part-groups/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, groupId: null, partIds: [partId] }),
    });
    if (!res.ok) { toast.error(await errorOf(res, "Failed")); return; }
    changed();
  }

  const partsByGroup = React.useMemo(() => {
    const m = new Map<string, { part: TakeoffPartRow; dwg: string }[]>();
    for (const d of drawings) for (const part of d.parts) if (part.groupId) m.set(part.groupId, [...(m.get(part.groupId) ?? []), { part, dwg: d.drawingNumber }]);
    return m;
  }, [drawings]);
  const [expandedParts, setExpandedParts] = React.useState<Set<string>>(new Set());

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <button type="button" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <ListTree className="h-4 w-4 text-muted-foreground" /> BOQ — Assemblies
        </button>
        {boq && (
          <p className="text-xs text-muted-foreground">
            Fabricated <span className="font-medium text-foreground">{fmt(boq.project.fabricatedKg)} kg</span>
            {"  ·  "}Purchased accessories <span className="font-medium text-foreground">{fmt(boq.project.accessoriesKg)} kg</span>
            {"  ·  "}Total <span className="font-semibold text-primary">{fmt(boq.project.totalKg)} kg</span>
            {boq.project.accessoriesWithoutWeight > 0 && <span className="text-amber-600">  ·  {boq.project.accessoriesWithoutWeight} accessories without weight</span>}
          </p>
        )}
        {canCreate && <Button size="sm" onClick={() => setForm({ open: true, editing: null })}><Plus className="h-4 w-4" /> New Assembly</Button>}
      </div>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-muted-foreground">
                <th className="px-3 py-2">Assembly</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Total qty</th>
                <th className="px-2 py-2 text-right">Parts</th><th className="px-2 py-2 text-right">Fabricated kg</th>
                <th className="px-2 py-2 text-right">Accessories kg</th><th className="px-2 py-2 text-right">Total kg</th>
                <th className="px-2 py-2 text-right">kg / assembly</th><th className="w-28 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">No assemblies yet — create one, then add parts to it.</td></tr>
              )}
              {rows.map(({ g, depth, hasKids }) => (
                <React.Fragment key={g.id}>
                  <tr className="border-b border-border hover:bg-muted/10">
                    <td className="px-3 py-1.5" style={{ paddingLeft: 12 + depth * 18 }}>
                      <div className="flex items-center gap-1.5">
                        {hasKids ? (
                          <button type="button" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                            {collapsed.has(g.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : <span className="w-3.5" />}
                        <button type="button" className="text-left" onClick={() => setExpandedParts((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                          <span className="font-semibold">{g.code}</span> <span className="text-foreground">{g.name}</span>
                          {g.remark && <span className="ml-2 text-muted-foreground">({g.remark})</span>}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{g.qty}{g.parentId ? " /asm" : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{g.effectiveQty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{g.partCount}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(g.subtree.fabricatedKg)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(g.subtree.accessoriesKg)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(g.subtree.totalKg)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{g.perAssembly ? fmt(g.perAssembly.totalKg, 2) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-0.5">
                        {canCreate && <Button size="icon" variant="ghost" className="h-7 w-7" title="Add parts" onClick={() => setAssign(g)}><PackagePlus className="h-3.5 w-3.5" /></Button>}
                        {canCreate && <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setForm({ open: true, editing: g })}><Pencil className="h-3.5 w-3.5" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => setDeleting(g)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                      </div>
                    </td>
                  </tr>
                  {expandedParts.has(g.id) && (partsByGroup.get(g.id) ?? []).map(({ part, dwg }) => (
                    <tr key={part.id} className="border-b border-border bg-muted/10 text-muted-foreground">
                      <td className="py-1 pr-3" style={{ paddingLeft: 40 + depth * 18 }}>
                        {part.posNo ? `${part.posNo} · ` : ""}{part.description} <span className="opacity-70">({dwg} #{part.itemNo}{part.partType === "ACCESSORY" ? ", accessory" : ""})</span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{part.qtyPerAssembly} /asm</td>
                      <td className="px-2 py-1 text-right tabular-nums">{part.qty}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-1 text-right tabular-nums">{part.partType === "ACCESSORY" ? "" : fmt(part.weightKg)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{part.partType === "ACCESSORY" ? (part.weightKg > 0 ? fmt(part.weightKg, 2) : "no weight") : ""}</td>
                      <td colSpan={2} className="px-2 py-1 text-right">
                        {canCreate && <button type="button" className="text-[11px] text-primary underline" onClick={() => ungroup(part.id)}>Take out</button>}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {boq && boq.ungrouped.partCount > 0 && (
                <tr className="bg-muted/10 text-muted-foreground">
                  <td className="px-3 py-1.5">Ungrouped parts</td><td /><td />
                  <td className="px-2 py-1.5 text-right tabular-nums">{boq.ungrouped.partCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(boq.ungrouped.weight.fabricatedKg)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(boq.ungrouped.weight.accessoriesKg)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(boq.ungrouped.weight.totalKg)}</td><td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            A sub-assembly&apos;s weight is included in its parent&apos;s row; the project totals above are summed from the parts, so nothing is counted twice.
          </p>
        </div>
      )}

      {canCreate && <GroupForm open={form.open} onOpenChange={(v) => setForm((f) => ({ ...f, open: v }))} projectId={projectId} editing={form.editing} groups={boq?.groups ?? []} onSaved={changed} />}
      {canCreate && <AssignDialog open={!!assign} onOpenChange={(v) => !v && setAssign(null)} projectId={projectId} group={assign} groups={boq?.groups ?? []} drawings={drawings} onDone={changed} />}
      <ConfirmDialog
        open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete assembly?" description={`"${deleting?.code}" will be removed. Its parts stay in the take-off with their current quantities.`}
        confirmLabel="Delete" loading={delBusy} onConfirm={confirmDelete}
      />
    </div>
  );
}
