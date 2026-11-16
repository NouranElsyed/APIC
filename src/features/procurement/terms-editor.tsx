"use client";
import * as React from "react";
import { Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Payment terms are stored as one text, one term per line. */
export const parseTerms = (s: string | null | undefined): string[] => (s ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
export const joinTerms = (terms: string[]): string | null => { const t = terms.map((x) => x.trim()).filter(Boolean); return t.length ? t.join("\n") : null; };

/** List of payment terms: type a term, add another, delete any of them. */
export function TermsEditor({ terms, onChange, label = "Payment terms" }: { terms: string[]; onChange: (t: string[]) => void; label?: string }) {
  const set = (i: number, v: string) => onChange(terms.map((t, j) => (j === i ? v : t)));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      {terms.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
          <Input value={t} onChange={(e) => set(i, e.target.value)} placeholder="e.g. 50% advance, 50% on delivery" maxLength={200} className="h-9" />
          <button type="button" aria-label={`Delete term ${i + 1}`} className="text-destructive" onClick={() => onChange(terms.filter((_, j) => j !== i))}><XCircle className="h-4 w-4" /></button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...terms, ""])}><Plus /> Add new term</Button>
    </div>
  );
}
