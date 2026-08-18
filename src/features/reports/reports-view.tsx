"use client";
import * as React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { ProjectStatusBadge, RoleBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface ReportData {
  projects: any[];
  customers: any[];
  documents: any[];
  activity: any[];
}

export function ReportsView() {
  const [data, setData] = React.useState<ReportData | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  React.useEffect(() => {
    fetch("/api/reports").then((r) => r.json()).then(setData);
  }, []);

  function withinRange(dateStr: string) {
    const d = new Date(dateStr).getTime();
    if (from && d < new Date(from).getTime()) return false;
    if (to && d > new Date(to).getTime() + 86400000) return false;
    return true;
  }

  if (!data) return <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading reports…</div>;

  const projects = data.projects.filter((p) => withinRange(p.createdAt));
  const customers = data.customers.filter((c) => withinRange(c.createdAt));
  const documents = data.documents.filter((d) => withinRange(d.uploadDate));
  const activity = data.activity.filter((a) => withinRange(a.timestamp));

  const byStatus = ["UNDER_STUDY", "SUBMITTED", "APOLOGIZED", "CANCELLED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({
    status: s.replace("_", " "), count: projects.filter((p) => p.status === s).length,
  }));

  const projectColumns: ColumnDef<any, any>[] = [
    { accessorKey: "number", header: "Project #" },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "customer.name", header: "Customer", cell: ({ row }) => row.original.customer.name },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <ProjectStatusBadge status={row.original.status} /> },
    { accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
  ];

  const customerColumns: ColumnDef<any, any>[] = [
    { accessorKey: "code", header: "Code" },
    { accessorKey: "name", header: "Company" },
    { accessorKey: "_count.projects", header: "Projects", cell: ({ row }) => row.original._count.projects },
    { accessorKey: "createdAt", header: "Added", cell: ({ row }) => formatDate(row.original.createdAt) },
  ];

  const documentColumns: ColumnDef<any, any>[] = [
    { accessorKey: "title", header: "Title" },
    { accessorKey: "project.name", header: "Project", cell: ({ row }) => row.original.project.name },
    { accessorKey: "category", header: "Category" },
    { accessorKey: "uploadDate", header: "Uploaded", cell: ({ row }) => formatDate(row.original.uploadDate) },
  ];

  const activityColumns: ColumnDef<any, any>[] = [
    { accessorKey: "user.name", header: "User", cell: ({ row }) => row.original.user.name },
    { accessorKey: "user.role", header: "Role", cell: ({ row }) => <RoleBadge role={row.original.user.role} /> },
    { accessorKey: "action", header: "Action" },
    { accessorKey: "entity", header: "Entity" },
    { accessorKey: "timestamp", header: "When", cell: ({ row }) => formatDate(row.original.timestamp) },
  ];

  function exportCsv(rows: any[], filename: string) {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object");
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          {(from || to) && <Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
        </CardContent>
      </Card>

      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects Report</TabsTrigger>
          <TabsTrigger value="customers">Customer Report</TabsTrigger>
          <TabsTrigger value="documents">Documents Report</TabsTrigger>
          <TabsTrigger value="activity">User Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Projects by Status</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Projects</CardTitle><CardDescription>{projects.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(projects, "projects-report.csv")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={projectColumns} data={projects} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Customers</CardTitle><CardDescription>{customers.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(customers, "customers-report.csv")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={customerColumns} data={customers} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Documents</CardTitle><CardDescription>{documents.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(documents, "documents-report.csv")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={documentColumns} data={documents} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>User Activity</CardTitle><CardDescription>{activity.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(activity, "activity-report.csv")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={activityColumns} data={activity} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
