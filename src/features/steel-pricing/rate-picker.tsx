"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RateInput } from "./pricing-inputs";
import { addOption, componentLabel, isPercentGroup, newOptionId, optionsOf, removeOption, renameOption, setOptionValue, type RateOption } from "./rate-options";
import { fmt2 } from "./steel-pricing-engine";
import type { RateBook } from "./types";

const MANAGE = "__manage";
const fmtValue = (o: RateOption, pctGroup: boolean) => (pctGroup ? `${+(o.value * 100).toFixed(3)}%` : fmt2(o.value));

/**
 * Dropdown next to a component's checkbox: pick which price it uses (Profile A–E or a price you added).
 * "Add / edit prices…" opens the price library for that component. Prices live in the rate book, so a price
 * added here can be picked on any other item, and changing its value updates every item that uses it.
 */
export function RatePicker({ R, componentId, groupId = componentId, current, onSelect, onRates }: {
  R: RateBook;
  componentId: string;
  /** Rate group holding the prices (differs from componentId only for painting priced per m²). */
  groupId?: string;
  /** Selected option id, or "item" when the item carries its own workbook rate. */
  current: string;
  onSelect: (optionId: string) => void;
  onRates: (fn: (r: RateBook) => RateBook) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const pct = isPercentGroup(groupId);
  const options = optionsOf(R, groupId);
  const known = options.some((o) => o.id === current);
  return (
    <>
      <Select value={current} onValueChange={(v) => (v === MANAGE ? setOpen(true) : onSelect(v))}>
        <SelectTrigger className="h-6 w-40 px-2 text-[11px]" aria-label={`${componentLabel(componentId)} price`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {current === "item" && <SelectItem value="item">Item rate (workbook)</SelectItem>}
          {!known && current !== "item" && <SelectItem value={current}>Removed price → A</SelectItem>}
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label} · {fmtValue(o, pct)}</SelectItem>)}
          <SelectItem value={MANAGE}>+ Add / edit prices…</SelectItem>
        </SelectContent>
      </Select>
      {open && <RateLibraryDialog R={R} componentId={componentId} groupId={groupId} onClose={() => setOpen(false)} onSelect={onSelect} onRates={onRates} />}
    </>
  );
}

function RateLibraryDialog({ R, componentId, groupId, onClose, onSelect, onRates }: {
  R: RateBook; componentId: string; groupId: string; onClose: () => void;
  onSelect: (id: string) => void; onRates: (fn: (r: RateBook) => RateBook) => void;
}) {
  const pct = isPercentGroup(groupId);
  const options = optionsOf(R, groupId);
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");
  const add = () => {
    const n = price.trim() === "" ? NaN : Number(price) / (pct ? 100 : 1);
    if (!name.trim() || !isFinite(n) || n < 0) return;
    const id = newOptionId();
    const label = name.trim().slice(0, 60);
    onRates((r) => addOption(r, groupId, id, label, n));
    onSelect(id); // use it right away on this item
    setName(""); setPrice("");
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prices — {componentLabel(componentId)}</DialogTitle>
          <DialogDescription>
            Saved in this browser and available on every item. Changing a price here updates every item that uses it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {options.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-xs">
              {o.custom
                ? <Input value={R.rateLabels[o.id] ?? ""} onChange={(e) => onRates((r) => renameOption(r, o.id, e.target.value))} className="h-7 flex-1 text-xs" aria-label="Price name" />
                : <span className="flex-1">{o.label} <span className="text-muted-foreground">(workbook)</span></span>}
              <RateInput value={o.value} scale={pct ? 100 : 1} suffix={pct ? "%" : undefined} decimals={2} className="w-28" onChange={(v) => onRates((r) => setOptionValue(r, groupId, o.id, v))} />
              {o.custom
                ? <button type="button" onClick={() => onRates((r) => removeOption(r, groupId, o.id))} className="text-muted-foreground hover:text-destructive" title="Delete this price" aria-label={`Delete ${o.label}`}><Trash2 className="h-3.5 w-3.5" /></button>
                : <span className="w-3.5" />}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3" onKeyDown={(e) => { if (e.key === "Enter") add(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New price name (e.g. Supplier X)" className="h-8 min-w-[10rem] flex-1 text-xs" />
          <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={pct ? "%" : "EGP"} inputMode="decimal" className="h-8 w-24 text-right font-mono text-xs" />
          <Button type="button" size="sm" onClick={add} disabled={!name.trim() || price.trim() === ""}><Plus className="h-3.5 w-3.5" /> Add &amp; use</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Deleting a price makes any item still using it fall back to Profile A.</p>
      </DialogContent>
    </Dialog>
  );
}
