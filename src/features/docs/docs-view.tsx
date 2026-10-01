"use client";
import * as React from "react";
import { Search, Info, Lightbulb, TriangleAlert, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SECTIONS, TABS, type Block, type DocSection, type TabId } from "./docs-content";

/** Renders `code` and **bold** inside a plain string. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{p.slice(1, -1)}</code>
        ) : p.startsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

const CALLOUT = {
  tip: { icon: Lightbulb, cls: "border-emerald-500/40 bg-emerald-500/5", label: "Tip" },
  note: { icon: Info, cls: "border-blue-500/40 bg-blue-500/5", label: "Note" },
  warn: { icon: TriangleAlert, cls: "border-amber-500/50 bg-amber-500/5", label: "Important" },
} as const;

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return <p className="text-sm leading-relaxed text-muted-foreground"><Rich text={b.text} /></p>;
    case "steps":
      return (
        <ol className="space-y-2">
          {b.items.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
              <span><Rich text={s} /></span>
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary/60">
          {b.items.map((s, i) => <li key={i}><Rich text={s} /></li>)}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                {b.head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-border align-top">
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-3 py-2", j === 0 ? "font-medium text-foreground" : "text-muted-foreground")}><Rich text={c} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "keys":
      return (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {b.rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <kbd className="min-w-40 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{k}</kbd>
              <span className="text-muted-foreground"><Rich text={v} /></span>
            </div>
          ))}
        </div>
      );
    default: {
      const c = CALLOUT[b.t];
      const Icon = c.icon;
      return (
        <div className={cn("flex gap-2.5 rounded-lg border p-3 text-sm leading-relaxed text-muted-foreground", c.cls)}>
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
          <p><span className="font-semibold text-foreground">{c.label}: </span><Rich text={b.text} /></p>
        </div>
      );
    }
  }
}

function plain(s: DocSection): string {
  const bits: string[] = [s.title, s.summary];
  for (const b of s.blocks) {
    if ("text" in b) bits.push(b.text);
    else if ("items" in b) bits.push(...b.items);
    else if (b.t === "table") bits.push(...b.head, ...b.rows.flat());
    else if (b.t === "keys") bits.push(...b.rows.flat());
  }
  return bits.join(" ").toLowerCase();
}

export function DocsView() {
  const [tab, setTab] = React.useState<TabId | "all">("all");
  const [q, setQ] = React.useState("");

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SECTIONS.filter((s) => (tab === "all" || s.tab === tab) && (!needle || plain(s).includes(needle)));
  }, [tab, q]);

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold">Nesting & Costing guide</h2>
            <p className="text-sm text-muted-foreground">Every feature and every way to use the Nesting &amp; Costing tabs: Standard Calculations and DXF Nesting.</p>
          </div>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search the docs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {[{ id: "all" as const, label: "All tabs" }, ...TABS].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="hidden max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-card p-3 text-sm lg:sticky lg:top-4 lg:block">
          {TABS.filter((t) => shown.some((s) => s.tab === t.id)).map((t) => (
            <div key={t.id} className="mb-3 last:mb-0">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
              {shown.filter((s) => s.tab === t.id).map((s) => (
                <a key={s.id} href={`#${s.id}`} className="block rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">{s.title}</a>
              ))}
            </div>
          ))}
          {shown.length === 0 && <p className="px-2 text-xs text-muted-foreground">No matches.</p>}
        </nav>

        <div className="min-w-0 space-y-8">
          {shown.length === 0 && (
            <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Nothing matches “{q}”. Try another word.</div>
          )}
          {TABS.filter((t) => shown.some((s) => s.tab === t.id)).map((t) => (
            <section key={t.id} className="space-y-4">
              <div className="border-b border-border pb-2">
                <h2 className="text-lg font-semibold">{t.label}</h2>
                <p className="text-xs text-muted-foreground">{t.blurb}</p>
              </div>
              {shown.filter((s) => s.tab === t.id).map((s) => (
                <Card key={s.id} id={s.id} className="scroll-mt-4 space-y-3 p-5">
                  <div>
                    <h3 className="text-sm font-semibold">{s.title}</h3>
                    <p className="text-xs text-muted-foreground">{s.summary}</p>
                  </div>
                  {s.blocks.map((b, i) => <BlockView key={i} b={b} />)}
                </Card>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
