"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TakeoffProjectProvider } from "./project-context";
import { WorkspaceBar } from "./workspace-bar";

function activeTabClass(isActive: boolean) {
  return isActive
    ? "border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground"
    : "px-1 pb-2 text-sm font-medium text-muted-foreground transition hover:text-foreground";
}

function TakeoffTopBar({ showScrap, showSteelPricing }: { showScrap: boolean; showSteelPricing: boolean }) {
  const pathname = usePathname();
  const isNesting = pathname?.startsWith("/takeoff/nesting") ?? false;
  const isScrap = pathname?.startsWith("/takeoff/scrap-material") ?? false;
  const isSteelPricing = pathname?.startsWith("/takeoff/steel-pricing") ?? false;
  const isStandard = !isNesting && !isScrap && !isSteelPricing;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border">
        <Link href="/takeoff" className={activeTabClass(isStandard)}>
          Standard Calculations
        </Link>
        <Link href="/takeoff/nesting" className={activeTabClass(isNesting)}>
          DXF Nesting
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
