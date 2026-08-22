import { TakeoffShell } from "@/features/takeoff/takeoff-shell";

export default function TakeoffLayout({ children }: { children: React.ReactNode }) {
  return <TakeoffShell>{children}</TakeoffShell>;
}
