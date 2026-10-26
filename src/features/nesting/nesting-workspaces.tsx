"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { NestBoost } from "./nest-boost/nest-boost";
import { NestBoost1D } from "./nest-boost-1d/nest-boost-1d";
import { CombinedReportButton } from "./combined-report-button";

/**
 * The two nesting workspaces, one at a time: `?view=1d` shows 1D (bars, pipes, profiles), anything else shows 2D (DXF on sheets).
 * BOTH stay mounted — the inactive one is only hidden — so state, results, auto-save and parts sent from
 * Standard Calculations all survive switching.
 */
export function NestingWorkspaces() {
  const view = useSearchParams().get("view") === "1d" ? "1d" : "2d";
  return (
    <div className="space-y-4">
      <div hidden={view !== "2d"}>
        <NestBoost active={view === "2d"} />
      </div>
      <div hidden={view !== "1d"}>
        <NestBoost1D />
      </div>
      <CombinedReportButton />
    </div>
  );
}
