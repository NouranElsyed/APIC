import { NestBoost } from "@/features/nesting/nest-boost/nest-boost";

// DXF Nesting tab — native Nest Boost tool (client-side nesting, no database).
export default function NestingPage() {
  return <NestBoost />;
}
