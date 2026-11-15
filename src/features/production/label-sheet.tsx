"use client";
import * as React from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LabelData {
  number: string; description: string; partNo: number | null; material: string | null; weightKg: number;
  project: { number: string; name: string }; codes: string[];
}

/** QR labels, one per piece. Each QR opens /scan/<code> on the phone that scans it. */
export function LabelSheet({ data }: { data: LabelData }) {
  const [qr, setQr] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const origin = window.location.origin;
      const entries = await Promise.all(data.codes.map(async (c) => [c, await QRCode.toDataURL(`${origin}/scan/${encodeURIComponent(c)}`, { margin: 1, width: 240, errorCorrectionLevel: "M" })] as const));
      if (!cancelled) setQr(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [data.codes]);

  return (
    <div className="mx-auto max-w-[900px] space-y-4 bg-white p-6 text-black print:p-0">
      <style>{`@page { size: A4; margin: 8mm; } @media print { .no-print { display: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-gray-600">{data.codes.length} label{data.codes.length === 1 ? "" : "s"} · {data.number}</p>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print labels</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {data.codes.map((c) => (
          <div key={c} className="flex break-inside-avoid items-center gap-2 rounded border border-gray-400 p-2" style={{ height: "36mm" }}>
            <div className="h-[28mm] w-[28mm] shrink-0">{qr[c] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr[c]} alt={`QR ${c}`} className="h-full w-full" /> : null}</div>
            <div className="min-w-0 text-[9px] leading-tight">
              <p className="text-[11px] font-bold">{c}</p>
              <p className="truncate font-semibold">{data.partNo != null && `#${data.partNo} `}{data.description}</p>
              <p className="truncate text-gray-600">{[data.material, `${data.weightKg} kg`].filter(Boolean).join(" · ")}</p>
              <p className="truncate text-gray-600">{data.project.number}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
