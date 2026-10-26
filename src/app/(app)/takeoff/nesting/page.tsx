import { Suspense } from "react";
import { NestingWorkspaces } from "@/features/nesting/nesting-workspaces";

// Nesting tabs — "DXF Nesting" (2D, sheets) and "1D Nesting" (bars, pipes & profiles): native Nest Boost tools
// (client-side nesting, no database). Which one is open is chosen with ?view=1d (see the Takeoff tab bar).
export default function NestingPage() {
  return (
    <Suspense fallback={null}>
      <NestingWorkspaces />
    </Suspense>
  );
}
