"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { CompanySettingsInput } from "@/server/validators/settings";

export function SettingsView() {
  const [loading, setLoading] = React.useState(true);
  const { register, handleSubmit, control, reset, formState: { isSubmitting } } = useForm<CompanySettingsInput>();

  React.useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => { reset(data); setLoading(false); });
  }, [reset]);

  async function onSubmit(values: CompanySettingsInput) {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!res.ok) { toast.error("Failed to save settings"); return; }
    toast.success("Settings saved");
  }

  if (loading) return <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading settings…</div>;

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Tabs defaultValue="company">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
          </TabsList>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
          </Button>
        </div>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
              <CardDescription>Basic company information shown across the platform.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Company Name</Label>
                <Input {...register("name")} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Logo URL</Label>
                <Input {...register("logoUrl")} placeholder="https://…" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Address</Label>
                <Input {...register("address")} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input {...register("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" {...register("email")} />
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Input {...register("timezone")} placeholder="Africa/Cairo" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>System Preferences</CardTitle>
              <CardDescription>Regional and display settings. No pricing settings in Phase 1.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Controller control={control} name="language" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ar">Arabic</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1.5">
                <Label>Date Format</Label>
                <Controller control={control} name="dateFormat" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency (display only)</Label>
                <Input {...register("currency")} placeholder="EGP" />
              </div>
              <div className="space-y-1.5">
                <Label>Theme</Label>
                <Controller control={control} name="theme" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Configuration</CardTitle>
              <CardDescription>Project status labels, revision format, and auto-save.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default Revision Format</Label>
                <Input {...register("defaultRevisionFormat")} placeholder="Rev. 00" />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 sm:col-span-2">
                <div>
                  <Label className="text-sm">Auto-save</Label>
                  <p className="text-xs text-muted-foreground">Automatically save form drafts while editing.</p>
                </div>
                <Controller control={control} name="autoSave" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </form>
  );
}
