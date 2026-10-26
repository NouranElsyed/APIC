"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TakeoffProjectProvider } from "./project-context";
import { WorkspaceBar } from "./workspace-bar";

function activeTabClass(isActive: boolean) {
  return isActive
    ? "border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground"
    : "px-1 pb-2 text-sm font-medium text-muted-foreground transition hover:text-foreground";
}

/** "DXF Nesting" (2D) and "1D Nesting" are two views of the same page: `?view=1d` opens the 1D one. */
function NestingTabLinks({ isNesting }: { isNesting: boolean }) {
  const view = useSearchParams().get("view");
  const is1D = isNesting && view === "1d";
  return (
    <>
      <Link href="/takeoff/nesting" scroll={false} className={activeTabClass(isNesting && !is1D)}>
        DXF Nesting
      </Link>
      <Link href="/takeoff/nesting?view=1d" scroll={false} className={activeTabClass(is1D)}>
        1D Nesting
      </Link>
    </>
  );
}

function TakeoffTopBar({ showScrap, showSteelPricing }: { showScrap: boolean; showSteelPricing: boolean }) {
  const pathname = usePathname();
  const isNesting = pathname?.startsWith("/takeoff/nesting") ?? false;
  const isScrap = pathname?.startsWith("/takeoff/scrap-material") ?? false;
  const isSteelPricing = pathname?.startsWith("/takeoff/steel-pricing") ?? false;
  const isNozzles = pathname?.startsWith("/takeoff/nozzles") ?? false;
  const isStandard = !isNesting && !isScrap && !isSteelPricing && !isNozzles;

  return (
    <div className="space-y-6">
      <div className="flex gap-5 overflow-x-auto border-b border-border">
        <Link href="/takeoff" className={activeTabClass(isStandard)}>
          Standard Calculations
        </Link>
        <React.Suspense
          fallback={
            <>
              <Link href="/takeoff/nesting" scroll={false} className={activeTabClass(isNesting)}>DXF Nesting</Link>
              <Link href="/takeoff/nesting?view=1d" scroll={false} className={activeTabClass(false)}>1D Nesting</Link>
            </>
          }
        >
          <NestingTabLinks isNesting={isNesting} />
        </React.Suspense>
        <Link href="/takeoff/nozzles" className={activeTabClass(isNozzles)}>
          Nozzles
        </Link>
        {showScrap && (
          <Link href="/takeoff/scrap-material" className={activeTabClass(isScrap)}>
            Scrap & Material
          </Link>
        )}
        {showSteelPricing && (
          <Link href="/takeoff/steel-pricing" className={activeTabClass(isSteelPricing)}>
            Steel Pricing
          </Link>
        )}
      </div>

      <WorkspaceBar />
    </div>
  );
}

export function TakeoffShell({
  children,
  showScrap = false,
  showSteelPricing = false,
}: {
  children: React.ReactNode;
  showScrap?: boolean;
  showSteelPricing?: boolean;
}) {
  return (
    <TakeoffProjectProvider>
      <div className="space-y-6">
        <TakeoffTopBar showScrap={showScrap} showSteelPricing={showSteelPricing} />
        {children}
      </div>
    </TakeoffProjectProvider>
  );
}
