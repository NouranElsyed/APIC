import { NestBoost } from "@/features/nesting/nest-boost/nest-boost";
import { CombinedReportButton } from "@/features/nesting/combined-report-button";
import { NestBoost1D } from "@/features/nesting/nest-boost-1d/nest-boost-1d";

// DXF Nesting tab — native Nest Boost tool (client-side nesting, no database).
export default function NestingPage() {
  return (
    <div className="space-y-8">
      <NestBoost />
      <div>
        <h2 className="mb-1 text-lg font-semibold">1D Nesting — bars, pipes &amp; profiles</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          For hot-rolled / linear stock (plate bars, pipes, angles, channels...): cuts are laid out along the length
          of a stock bar instead of on a sheet.
        </p>
        <NestBoost1D />
      </div>
      <CombinedReportButton />
    </div>
  );
}