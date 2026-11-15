"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PieceDTO, SyncResult } from "@/server/services/production.service";
import type { Stage } from "./production";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** What a phone shows after scanning a piece's QR code: where the piece is, and one big button for its next stage. */
export function ScanView({ initial, canUpdate }: { initial: PieceDTO; canUpdate: boolean }) {
  const [piece, setPiece] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const next = piece.stages.find((s) => s.canComplete);
  const lastDone = [...piece.stages].reverse().find((s) => s.doneAt);

  async function act(stage: Stage, action: "complete" | "undo") {
    setBusy(`${stage}:${action}`);
    try {
      const res = await fetch(`/api/pieces/${encodeURIComponent(piece.code)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, action }) });
      const body = (await res.json().catch(() => ({}))) as { piece?: PieceDTO; sync?: SyncResult; error?: string };
      if (!res.ok || !body.piece) throw new Error(body.error ?? "Could not update the piece");
      setPiece(body.piece);
      toast.success(action === "complete" ? "Stage recorded" : "Stage undone");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the piece"); } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card><CardContent className="space-y-1 p-5">
        <p className="text-xs font-medium text-muted-foreground">Piece {piece.seq} of {piece.qty}</p>
        <p className="text-2xl font-bold tracking-tight">{piece.code}</p>
        <p className="font-medium">{piece.workOrder.partNo != null && `#${piece.workOrder.partNo} `}{piece.workOrder.description}</p>
        <p className="text-sm text-muted-foreground">{[piece.workOrder.material, `${piece.weightKg} kg`].filter(Boolean).join(" · ")}</p>
        <Link href={`/projects/${piece.project.id}/production`} className="text-sm text-primary hover:underline">{piece.project.number} — {piece.project.name}</Link>
        <div className="pt-2">
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${piece.progress}%` }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{piece.progress}% complete</p>
        </div>
      </CardContent></Card>

      <Card><CardContent className="divide-y divide-border p-0">
        {piece.stages.map((s) => (
          <div key={s.stage} className="flex items-center gap-3 px-5 py-3">
            {s.doneAt ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <span className={cn("flex-1 font-medium", !s.doneAt && "text-muted-foreground")}>{s.label}</span>
            <span className="text-xs text-muted-foreground">{s.doneAt ? when(s.doneAt) : ""}</span>
          </div>
        ))}
      </CardContent></Card>

      {canUpdate ? (
        <div className="space-y-2">
          {next ? (
            <Button className="h-14 w-full text-base" disabled={!!busy} onClick={() => void act(next.stage, "complete")}>
              {busy === `${next.stage}:complete` && <Loader2 className="animate-spin" />} {next.label} finished
            </Button>
          ) : <p className="rounded-lg bg-green-500/10 p-4 text-center font-medium text-green-700">All stages finished</p>}
          {lastDone && lastDone.canUndo && (
            <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => void act(lastDone.stage, "undo")}>
              {busy === `${lastDone.stage}:undo` ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo {lastDone.label.toLowerCase()}
            </Button>
          )}
        </div>
      ) : <p className="text-center text-sm text-muted-foreground">You can view this piece but not record progress.</p>}
    </div>
  );
}
