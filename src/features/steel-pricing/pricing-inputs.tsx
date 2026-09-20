"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Numeric input that edits a stored value through a display scale (e.g. fraction 0.07 shown as 7 %). */
export function RateInput({
  value, onChange, scale = 1, decimals = 2, suffix, className, highlight, placeholder = "—",
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  scale?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  highlight?: boolean;
  placeholder?: string;
}) {
  const fmtVal = React.useCallback(
    (v: number | undefined) => (v === undefined ? "" : String(Number((v * scale).toFixed(decimals + 4)))),
    [scale, decimals]
  );
  const [text, setText] = React.useState(fmtVal(value));
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setText(fmtVal(value));
  }, [value, fmtVal]);

  return (
    <span className="relative inline-flex items-center">
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => { focused.current = false; setText(fmtVal(value)); }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = t.trim() === "" ? 0 : Number(t);
          if (isFinite(n)) onChange(n / scale);
        }}
        className={cn(
          "h-7 w-full min-w-[64px] rounded-md border border-input bg-card px-2 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring",
          highlight && "border-primary/40 bg-primary/5 font-semibold text-primary",
          suffix && "pr-6",
          className
        )}
      />
      {suffix && <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">{suffix}</span>}
    </span>
  );
}

export function SectionTitle({ n, title, hint }: { n?: number; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold">{n ? `${n}. ` : ""}{title}</h3>
      {hint && <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
