"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { UserRow } from "./types";

const ROLES = ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"];

interface FormValues {
  name: string; email: string; password: string; role: string; department: string; active: boolean;
}

export function UserForm({
  open, onOpenChange, user, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; user?: UserRow | null; onSaved: () => void }) {
  const isEdit = !!user;
  const { register, handleSubmit, control, reset, formState: { isSubmitting, errors } } = useForm<FormValues>({
    defaultValues: { name: "", email: "", password: "", role: "VIEWER", department: "", active: true },
  });

  React.useEffect(() => {
    if (open) {
      reset(user ? { ...user, password: "", department: user.department ?? "" } : { name: "", email: "", password: "", role: "VIEWER", department: "", active: true });
    }
  }, [open, user, reset]);

  async function onSubmit(values: FormValues) {
    const url = isEdit ? `/api/users/${user!.id}` : "/api/users";
    const method = isEdit ? "PUT" : "POST";
    const payload: Record<string, unknown> = { ...values };
    if (isEdit && !values.password) delete payload.password;

    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error || "Failed to save user");
      return;
    }
    toast.success(isEdit ? "User updated" : "User created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "New User"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update user details and access." : "Create a new platform user."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} placeholder="Ahmed Salah" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" {...register("email", { required: true })} placeholder="user@steelflow.com" />
          </div>
          <div className="space-y-1.5">
            <Label>{isEdit ? "New Password (optional)" : "Password"}</Label>
            <Input type="password" {...register("password")} placeholder="••••••••" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Controller
                control={control} name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input {...register("department")} placeholder="Engineering" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label className="text-sm">Active</Label>
            <Controller control={control} name="active" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
