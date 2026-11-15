"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** fetch + JSON, throwing the server's error message. */
export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export const money = (n: number, cur = "EGP") => `${cur} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const today = () => new Date().toISOString().slice(0, 10);

export const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1.5", className)}><Label className="text-xs">{label}</Label>{children}</div>;
}

export function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "muted" | "info"; children: React.ReactNode }) {
  const t = { good: "bg-green-500/10 text-green-700", warn: "bg-amber-500/10 text-amber-700", bad: "bg-red-500/10 text-red-700", muted: "bg-muted text-muted-foreground", info: "bg-primary/10 text-primary" }[tone];
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", t)}>{children}</span>;
}

export const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => <th className={cn("px-3 py-2.5 text-xs font-semibold text-muted-foreground", right ? "text-right" : "text-left")}>{children}</th>;
export const Td = ({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) => <td className={cn("px-3 py-2.5 align-top", right && "text-right tabular-nums", className)}>{children}</td>;

export function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
