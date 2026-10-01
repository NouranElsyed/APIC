import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex flex-col items-center gap-2 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="SteelFlow" className="h-14 w-14 object-contain" />
        <h1 className="text-xl font-semibold">SteelFlow ERP</h1>
        <p className="text-sm text-white/60">Core Platform · Phase 1</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
