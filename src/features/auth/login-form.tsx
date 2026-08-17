"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

const DEMO_USERS = [
  { role: "Admin", email: "admin@steelflow.com" },
  { role: "Manager", email: "manager@steelflow.com" },
  { role: "Engineer", email: "engineer@steelflow.com" },
  { role: "Viewer", email: "viewer@steelflow.com" },
];

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const {
    register, handleSubmit, setValue, formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "admin@steelflow.com", password: "password123" } });

  async function onSubmit(values: FormValues) {
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", { ...values, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(params.get("callbackUrl") || "/dashboard");
    router.refresh();
  }

  return (
    <Card className="border-white/10 bg-white shadow-xl">
      <CardHeader>
        <CardTitle className="text-base">Sign in to your account</CardTitle>
        <CardDescription>Use your SteelFlow credentials to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@steelflow.com" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        <div className="mt-6 rounded-lg border border-border bg-muted/50 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Demo accounts (password: password123)</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => {
                  setValue("email", u.email);
                  setValue("password", "password123");
                }}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs hover:bg-secondary"
              >
                <span className="block font-medium text-foreground">{u.role}</span>
                <span className="block truncate text-muted-foreground">{u.email}</span>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
