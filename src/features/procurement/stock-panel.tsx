"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StockDTO } from "@/server/services/stock.service";
import type { ProjectOpt } from "./orders-panel";
import { api, Empty, Field, fmtDate, num, Pill, selectClass, Td, Th } from "./ui";

interface Movement { id: string; delta: number; reason: string; projectId: string | null; note: string | null; userName: string | null; createdAt: string }
const REASON: Record<string, string> = { ADDED: "Added", REMNANT: "Remnant from nest", USED: "Used on project", SCRAPPED: "Scrapped", ADJUSTED: "Count adjusted" };

export function StockPanel({ stock, projects, canEdit }: { stock: StockDTO[]; projects: ProjectOpt[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<"" | "SHEET" | "REMNANT">("");
  const [adding, setAdding] = React.useState(false);
  const [adjust, setAdjust] = React.useState<StockDTO | null>(null);
  const [history, setHistory] = React.useState<{ item: StockDTO; rows: Movement[] } | null>(null);

  const term = q.trim().toLowerCase();
  const shown = stock.filter((s) => (!kind || s.kind === kind) && (!term || `${s.material} ${s.thicknessMm} ${s.widthMm}x${s.heightMm} ${s.location ?? ""} ${s.heatNo ?? ""}`.toLowerCase().includes(term)));
  const totalKg = shown.reduce((s, i) => s + i.weightKg * i.qty, 0);
  const pieces = shown.reduce((s, i) => s + i.qty, 0);

  async function showHistory(item: StockDTO) {
    try { setHistory({ item, rows: await api<Movement[]>(`/api/stock/${item.id}`) }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load the history"); }
  }
  const projName = (id: string | null) => { const p = projects.find((x) => x.id === id); return p ? p.number : ""; };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search thickness, material, size, location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${selectClass} w-40`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind"><option value="">All kinds</option><option value="SHEET">Sheets</option><option value="REMNANT">Remnants</option></select>
        <p className="text-xs text-muted-foreground">{pieces} piece{pieces === 1 ? "" : "s"} · {num(Math.round(totalKg))} kg</p>
        <div className="ml-auto">{canEdit && <Button onClick={() => setAdding(true)}><Plus /> Add to stock</Button>}</div>
      </div>
      {shown.length === 0 ? <Empty text={stock.length ? "Nothing matches the filter." : "The stock is empty. Register remnants from a nest, or add sheets by hand."} /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50"><tr><Th>Kind</Th><Th>Material</Th><Th right>Thickness</Th><Th right>Size (mm)</Th><Th right>Qty</Th><Th right>Weight</Th><Th>Location</Th><Th>Origin</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">{shown.map((s) => (
              <tr key={s.id} className="hover:bg-muted/30">
                <Td>{s.kind === "SHEET" ? <Pill tone="info">Sheet</Pill> : <Pill tone="warn">Remnant</Pill>}</Td>
                <Td>{s.material || "—"}{s.heatNo && <p className="text-xs text-muted-foreground">Heat {s.heatNo}</p>}</Td>
                <Td right>{num(s.thicknessMm)} mm</Td>
                <Td right>{num(s.widthMm)} × {num(s.heightMm)}</Td>
                <Td right className="font-semibold">{s.qty}</Td>
                <Td right>{num(Math.round(s.weightKg * s.qty))} kg</Td>
                <Td>{s.location ?? "—"}</Td>
                <Td className="text-xs text-muted-foreground">{s.origin === "NEST" ? "Nest" : s.origin === "RECEIPT" ? "Receipt" : "Manual"}{s.originProjectId && ` · ${projName(s.originProjectId)}`}<br />{fmtDate(s.updatedAt)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canEdit && <Button size="sm" variant="outline" onClick={() => setAdjust(s)}><Minus /> Use / adjust</Button>}
                  <Button size="icon" variant="ghost" aria-label="History" onClick={() => void showHistory(s)}><History /></Button>
                </Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} />}
      {adjust && <AdjustDialog item={adjust} projects={projects} onClose={() => setAdjust(null)} />}
      <Dialog open={!!history} onOpenChange={(v) => !v && setHistory(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Movements</DialogTitle>{history && <DialogDescription>{history.item.thicknessMm} mm {history.item.material} · {history.item.widthMm} × {history.item.heightMm}</DialogDescription>}</DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-auto text-sm">
            {history?.rows.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-2">
                <div><p className="font-medium">{REASON[m.reason] ?? m.reason}{m.projectId && <span className="font-normal text-muted-foreground"> · {projName(m.projectId)}</span>}</p><p className="text-xs text-muted-foreground">{fmtDate(m.createdAt)} · {m.userName ?? "—"}{m.note && ` · ${m.note}`}</p></div>
                <span className={m.delta > 0 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>{m.delta > 0 ? "+" : ""}{m.delta}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = React.useState({ kind: "SHEET", material: "", thicknessMm: "", widthMm: "", heightMm: "", qty: "1", location: "", heatNo: "" });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const ok = Number(f.thicknessMm) > 0 && Number(f.widthMm) > 0 && Number(f.heightMm) > 0 && Number(f.qty) >= 1;
  async function save() {
    setBusy(true);
    try {
      await api("/api/stock", { method: "POST", body: { kind: f.kind, material: f.material, thicknessMm: Number(f.thicknessMm), widthMm: Number(f.widthMm), heightMm: Number(f.heightMm), qty: Math.round(Number(f.qty)), location: f.location || null, heatNo: f.heatNo || null } });
      toast.success("Added to stock"); onClose(); router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not add"); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add to stock</DialogTitle><DialogDescription>An identical sheet or remnant already in stock just gets the quantity added.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind"><select className={selectClass} value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="SHEET">Sheet</option><option value="REMNANT">Remnant</option></select></Field>
          <Field label="Material"><Input value={f.material} onChange={(e) => set("material", e.target.value)} placeholder="ST37" /></Field>
          <Field label="Thickness (mm)"><Input type="number" min={0} step="any" value={f.thicknessMm} onChange={(e) => set("thicknessMm", e.target.value)} /></Field>
          <Field label="Quantity"><Input type="number" min={1} step={1} value={f.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
          <Field label="Length (mm)"><Input type="number" min={0} step="any" value={f.widthMm} onChange={(e) => set("widthMm", e.target.value)} /></Field>
          <Field label="Width (mm)"><Input type="number" min={0} step="any" value={f.heightMm} onChange={(e) => set("heightMm", e.target.value)} /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Rack A" /></Field>
          <Field label="Heat no."><Input value={f.heatNo} onChange={(e) => set("heatNo", e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy || !ok}>{busy && <Loader2 className="animate-spin" />} Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ item, projects, onClose }: { item: StockDTO; projects: ProjectOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"USED" | "SCRAPPED" | "ADDED" | "ADJUSTED">("USED");
  const [qty, setQty] = React.useState("1");
  const [projectId, setProjectId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const take = mode === "USED" || mode === "SCRAPPED";
  const n = Math.round(Number(qty));
  const delta = take ? -n : n;
  const bad = !(n >= 1) || (take && n > item.qty);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/stock/${item.id}`, { method: "PATCH", body: { delta, reason: mode, projectId: mode === "USED" && projectId ? projectId : null, note: note || null } });
      toast.success("Stock updated"); onClose(); router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update"); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Use / adjust stock</DialogTitle><DialogDescription>{item.thicknessMm} mm {item.material} · {item.widthMm} × {item.heightMm} — {item.qty} in stock</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="What happened"><select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="USED">Used on a project</option><option value="SCRAPPED">Scrapped</option><option value="ADDED">More found / returned</option><option value="ADJUSTED">Count correction (add)</option></select></Field>
          <Field label="Quantity"><Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          {mode === "USED" && <Field label="Project" className="col-span-2"><select className={selectClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">— none —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} — {p.name}</option>)}</select></Field>}
          <Field label="Note" className="col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {take && n > item.qty && <p className="text-xs text-red-600">Only {item.qty} in stock.</p>}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy || bad}>{busy && <Loader2 className="animate-spin" />} Save ({delta > 0 ? "+" : ""}{Number.isFinite(delta) ? delta : 0})</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
