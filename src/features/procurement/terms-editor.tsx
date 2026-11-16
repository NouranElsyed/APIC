"use client";
import * as React from "react";
import { Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Payment terms are stored as one text, one term per line. */
export const parseTerms = (s: string | null | undefined): string[] => (s ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
export const joinTerms = (terms: string[]): string | null => { const t = terms.map((x) => x.trim()).filter(Boolean); return t.length ? t.join("\n") : null; };

/** Splits pasted text into terms: one per line, dropping bullets ("*", "-", "•") and numbering ("1.", "2)"). */
export const splitPasted = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[*•\-–—▪●]+|\d+[.)])\s*/, "").trim()).filter(Boolean);

/** List of payment terms: type a term, add another, delete any of them. */
export function TermsEditor({ terms, onChange, label = "Payment terms" }: { terms: string[]; onChange: (t: string[]) => void; label?: string }) {
  const set = (i: number, v: string) => onChange(terms.map((t, j) => (j === i ? v : t)));
  // pasting several lines at once: each line becomes its own term (the current box is filled first if it is empty)
  const paste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/\r?\n/.test(text.trim())) return; // a single line pastes normally
    e.preventDefault();
    const parts = splitPasted(text);
    if (!parts.length) return;
    const here = terms[i].trim() === "";
    onChange([...terms.slice(0, here ? i : i + 1), ...parts, ...terms.slice(i + 1)]);
  };
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      {terms.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
          <Input value={t} onChange={(e) => set(i, e.target.value)} onPaste={(e) => paste(i, e)} placeholder="e.g. 50% advance, 50% on delivery — or paste a list" maxLength={200} className="h-9" />
          <button type="button" aria-label={`Delete term ${i + 1}`} className="text-destructive" onClick={() => onChange(terms.filter((_, j) => j !== i))}><XCircle className="h-4 w-4" /></button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...terms, ""])}><Plus /> Add new term</Button>
      <p className="text-[11px] text-muted-foreground">Tip: paste a whole list into any term box and each line becomes its own term.</p>
    </div>
  );
}
