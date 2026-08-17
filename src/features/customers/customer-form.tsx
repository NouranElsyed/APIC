"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { customerSchema, type CustomerInput } from "@/server/validators/customer";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomerRow } from "./types";

export function CustomerForm({
  open, onOpenChange, customer, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; customer?: CustomerRow | null; onSaved: () => void }) {
  const isEdit = !!customer;
  const {
    register, handleSubmit, reset, formState: { errors, isSubmitting },
  } = useForm<CustomerInput>({ resolver: zodResolver(customerSchema) });

  React.useEffect(() => {
    if (open) {
      reset(
        customer
          ? { ...customer }
          : { code: "", name: "", contact: "", email: "", phone: "", address: "", taxNumber: "", notes: "" }
      );
    }
  }, [open, customer, reset]);

  async function onSubmit(values: CustomerInput) {
    const url = isEdit ? `/api/customers/${customer!.id}` : "/api/customers";
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!res.ok) { toast.error("Failed to save customer"); return; }
    toast.success(isEdit ? "Customer updated" : "Customer created");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update customer details." : "Add a new customer to the directory."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer Code</Label>
              <Input {...register("code")} placeholder="CUST-001" />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Tax Number</Label>
              <Input {...register("taxNumber")} placeholder="EG-123456" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Company Name</Label>
            <Input {...register("name")} placeholder="Nile Steel Works" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Contact Person</Label>
              <Input {...register("contact")} placeholder="Ahmed Salah" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input {...register("phone")} placeholder="+20 10 000 0000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" {...register("email")} placeholder="contact@company.com" />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea {...register("address")} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea {...register("notes")} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
