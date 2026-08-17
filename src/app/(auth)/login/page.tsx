import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import { LayoutGrid } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex flex-col items-center gap-2 text-white">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold">SteelFlow ERP</h1>
        <p className="text-sm text-white/60">Core Platform · Phase 1</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
