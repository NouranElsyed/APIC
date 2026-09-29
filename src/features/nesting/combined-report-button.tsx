"use client";
import * as React from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getReportInputs, useReportAvailability } from "./report/report-store";

/** One Excel workbook with both the 2D (plates) and 1D (bars/pipes) results. */
export function CombinedReportButton() {
  const { projects, projectId } = useTakeoffProject();
  const { has2D, has1D } = useReportAvailability();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      const [{ buildReportCombined }, { saveBlob }] = await Promise.all([import("./report/report-combined"), import("./report/excel-common")]);
      const { d2, d1 } = getReportInputs();
      const blob = await buildReportCombined({ projectName: projects.find((p) => p.id === projectId)?.name, d2, d1 });
      saveBlob(blob, "nesting-report-1d-2d.xlsx");
      toast.success("Combined report downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the report");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Combined report — 1D + 2D</h3>
        <p className="text-xs text-muted-foreground">
          One Excel file with plates (2D) and bars/pipes (1D): overview, material used, scrap, parts and layout pictures.{" "}
          {has2D || has1D
            ? `Includes: ${[has2D && "2D", has1D && "1D"].filter(Boolean).join(" + ")}.`
            : "Run an optimization in 2D and/or 1D first."}
        </p>
      </div>
      <Button onClick={run} disabled={busy || (!has2D && !has1D)}>
        {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Create combined report (.xlsx)
      </Button>
    </Card>
  );
}
