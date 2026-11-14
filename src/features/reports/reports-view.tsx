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
  quotations: any[];
  materials: any[];
  schedules: any[];
}

type CsvColumn = { header: string; value: (row: any) => unknown };

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const text = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : "");

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
  const quotations = (data.quotations ?? []).filter((q) => withinRange(q.createdAt));
  const materials = (data.materials ?? []).filter((m) => withinRange(m.createdAt));
  const schedules = (data.schedules ?? []).filter((x) => withinRange(x.createdAt));

  const byStatus = ["UNDER_STUDY", "SUBMITTED", "APOLOGIZED", "CANCELLED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({
    status: s.replace("_", " "), count: projects.filter((p) => p.status === s).length,
  }));

  const quoteByStatus = ["DRAFT", "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"].map((st) => ({
    status: st.replace("_", " "),
    value: Math.round(quotations.filter((q) => q.status === st).reduce((sum, q) => sum + q.total, 0)),
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

  const money = (n: number, cur = "") => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}${cur ? ` ${cur}` : ""}`;

  const quotationColumns: ColumnDef<any, any>[] = [
    { accessorKey: "number", header: "Quotation", cell: ({ row }) => `${row.original.number}${row.original.revision ? ` Rev ${row.original.revision}` : ""}` },
    { accessorKey: "projectName", header: "Project", cell: ({ row }) => `${row.original.projectNumber} — ${row.original.projectName}` },
    { accessorKey: "customer", header: "Customer" },
    { accessorKey: "status", header: "Status", cell: ({ row }) => String(row.original.status).replace("_", " ") },
    { accessorKey: "total", header: "Total", cell: ({ row }) => money(row.original.total, row.original.currency) },
    { accessorKey: "issueDate", header: "Issued", cell: ({ row }) => formatDate(row.original.issueDate) },
  ];

  const materialColumns: ColumnDef<any, any>[] = [
    { accessorKey: "projectName", header: "Project", cell: ({ row }) => `${row.original.projectNumber} — ${row.original.projectName}` },
    { accessorKey: "description", header: "Material" },
    { accessorKey: "requiredQty", header: "Required", cell: ({ row }) => `${row.original.requiredQty.toLocaleString()} ${row.original.unit}` },
    { accessorKey: "orderedQty", header: "Ordered", cell: ({ row }) => row.original.orderedQty.toLocaleString() },
    { accessorKey: "receivedQty", header: "Received", cell: ({ row }) => row.original.receivedQty.toLocaleString() },
    { accessorKey: "toOrderQty", header: "Still to order", cell: ({ row }) => row.original.toOrderQty.toLocaleString() },
    { accessorKey: "neededBy", header: "Needed by", cell: ({ row }) => (row.original.neededBy ? formatDate(row.original.neededBy) : "—") },
  ];

  const scheduleColumns: ColumnDef<any, any>[] = [
    { accessorKey: "projectName", header: "Project", cell: ({ row }) => `${row.original.projectNumber} — ${row.original.projectName}` },
    { accessorKey: "name", header: "Schedule" },
    { accessorKey: "activities", header: "Activities" },
    { accessorKey: "percentComplete", header: "Avg. progress", cell: ({ row }) => `${row.original.percentComplete}%` },
    { accessorKey: "startDate", header: "Start", cell: ({ row }) => formatDate(row.original.startDate) },
    { accessorKey: "finishDate", header: "Finish", cell: ({ row }) => (row.original.finishDate ? formatDate(row.original.finishDate) : "—") },
  ];

  // Explicit column sets, so exported files carry the same readable fields as the tables
  // (customer / project / user names are nested objects and would otherwise be dropped).
  const csvSets: Record<string, CsvColumn[]> = {
    projects: [
      { header: "Project #", value: (r) => r.number }, { header: "Name", value: (r) => r.name },
      { header: "Customer", value: (r) => r.customer?.name }, { header: "Stage", value: (r) => r.stage },
      { header: "Status", value: (r) => r.status }, { header: "Revision", value: (r) => r.revision },
      { header: "Start", value: (r) => day(r.startDate) }, { header: "End", value: (r) => day(r.endDate) },
      { header: "Created by", value: (r) => r.createdBy?.name }, { header: "Created", value: (r) => day(r.createdAt) },
    ],
    customers: [
      { header: "Code", value: (r) => r.code }, { header: "Company", value: (r) => r.name },
      { header: "Projects", value: (r) => r._count?.projects }, { header: "Added", value: (r) => day(r.createdAt) },
    ],
    documents: [
      { header: "Title", value: (r) => r.title }, { header: "Project", value: (r) => (r.project ? `${r.project.number} — ${r.project.name}` : "") },
      { header: "Category", value: (r) => r.category }, { header: "Revision", value: (r) => r.revision },
      { header: "File", value: (r) => r.fileName }, { header: "Uploaded by", value: (r) => r.uploadedBy?.name },
      { header: "Uploaded", value: (r) => day(r.uploadDate) },
    ],
    activity: [
      { header: "User", value: (r) => r.user?.name }, { header: "Role", value: (r) => r.user?.role },
      { header: "Action", value: (r) => r.action }, { header: "Entity", value: (r) => r.entity },
      { header: "Detail", value: (r) => r.detail }, { header: "When", value: (r) => r.timestamp },
    ],
    quotations: [
      { header: "Quotation", value: (r) => r.number }, { header: "Revision", value: (r) => r.revision },
      { header: "Project #", value: (r) => r.projectNumber }, { header: "Project", value: (r) => r.projectName },
      { header: "Customer", value: (r) => r.customer }, { header: "Description", value: (r) => r.description },
      { header: "Status", value: (r) => r.status }, { header: "Currency", value: (r) => r.currency },
      { header: "Total", value: (r) => r.total }, { header: "Issued", value: (r) => day(r.issueDate) },
      { header: "Valid until", value: (r) => day(r.validUntil) },
    ],
    materials: [
      { header: "Project #", value: (r) => r.projectNumber }, { header: "Project", value: (r) => r.projectName },
      { header: "Code", value: (r) => r.code }, { header: "Material", value: (r) => r.description },
      { header: "Unit", value: (r) => r.unit }, { header: "Required", value: (r) => r.requiredQty },
      { header: "Ordered", value: (r) => r.orderedQty }, { header: "Received", value: (r) => r.receivedQty },
      { header: "Still to order", value: (r) => r.toOrderQty }, { header: "Ordered cost", value: (r) => r.orderedCost },
      { header: "Needed by", value: (r) => day(r.neededBy) },
    ],
    schedules: [
      { header: "Project #", value: (r) => r.projectNumber }, { header: "Project", value: (r) => r.projectName },
      { header: "Schedule", value: (r) => r.name }, { header: "Source", value: (r) => r.source },
      { header: "Activities", value: (r) => r.activities }, { header: "Avg. progress %", value: (r) => r.percentComplete },
      { header: "Start", value: (r) => day(r.startDate) }, { header: "Data date", value: (r) => day(r.dataDate) },
      { header: "Finish", value: (r) => day(r.finishDate) },
    ],
  };

  function exportCsv(rows: any[], filename: string, set: keyof typeof csvSets) {
    if (rows.length === 0) return;
    const cols = csvSets[set];
    const lines = [cols.map((c) => csvCell(c.header)).join(","), ...rows.map((r) => cols.map((c) => csvCell(c.value(r))).join(","))];
    // BOM so Excel opens UTF-8 (Arabic names etc.) correctly.
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
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
          <TabsTrigger value="quotations">Quotations</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
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
              <Button variant="outline" size="sm" onClick={() => exportCsv(projects, "projects-report.csv", "projects")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={projectColumns} data={projects} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Customers</CardTitle><CardDescription>{customers.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(customers, "customers-report.csv", "customers")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={customerColumns} data={customers} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Documents</CardTitle><CardDescription>{documents.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(documents, "documents-report.csv", "documents")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={documentColumns} data={documents} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>User Activity</CardTitle><CardDescription>{activity.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(activity, "activity-report.csv", "activity")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={activityColumns} data={activity} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Quotation value by status</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={quoteByStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Quotations</CardTitle><CardDescription>{quotations.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(quotations, "quotations-report.csv", "quotations")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={quotationColumns} data={quotations} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Materials</CardTitle><CardDescription>{materials.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(materials, "materials-report.csv", "materials")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={materialColumns} data={materials} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Schedules</CardTitle><CardDescription>{schedules.length} records</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportCsv(schedules, "schedules-report.csv", "schedules")}><Download className="h-4 w-4" /> Export</Button>
            </CardHeader>
            <CardContent><DataTable columns={scheduleColumns} data={schedules} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
