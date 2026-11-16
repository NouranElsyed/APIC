import { redirect } from "next/navigation";

// Root URL → dashboard. Logged-out visitors are then sent to /login by src/proxy.ts.
export default function Home() {
  redirect("/dashboard");
}
