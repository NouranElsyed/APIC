"use client";
import * as React from "react";
import Link from "next/link";
import {
  FolderKanban, Activity, Users2, FileText, ClipboardList, UserCog, ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { KpiCard } from "@/components/shared/kpi-card";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDate, initials } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

interface DashboardData {
  stats: {
    total: number; tendering: number; inProgress: number; onHold: number; completed: number; submitted: number; archived: number;
    customers: number; documents: number; pendingReviews: number; users: number;
  };
  recentActivity: { id: string; action: string; entity: string; detail: string | null; timestamp: string; user: { name: string; role: string } }[];
  monthlyActivity: { month: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  Tendering: "var(--color-chart-3)",
  "In Progress": "var(--color-chart-2)",
  "On Hold": "var(--color-chart-4)",
  Completed: "var(--color-chart-1)",
  Archived: "var(--color-chart-5)",
};

export function DashboardView() {
  const [data, setData] = React.useState<DashboardData | null>(null);

  React.useEffect(() => {
    fetch("/api/dashboard").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading dashboard…</div>;

  const { stats } = data;
  const statusData = [
    { name: "Tendering", value: stats.tendering },
    { name: "In Progress", value: stats.inProgress },
    { name: "On Hold", value: stats.onHold },
    { name: "Completed", value: stats.completed },
    { name: "Archived", value: stats.archived },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Projects" value={stats.total} icon={FolderKanban} tone="primary" />
        <KpiCard label="In Progress" value={stats.inProgress} icon={Activity} tone="accent" />
        <KpiCard label="Clients" value={stats.customers} icon={Users2} tone="violet" />
        <KpiCard label="Documents" value={stats.documents} icon={FileText} tone="slate" />
        <KpiCard label="Under Study" value={stats.pendingReviews} icon={ClipboardList} tone="warning" />
        <KpiCard label="Users" value={stats.users} icon={UserCog} tone="primary" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Project Activity</CardTitle>
            <CardDescription>Projects created over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyActivity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)" }} />
                <Bar dataKey="count" name="Projects" fill="var(--color-primary)" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects by Status</CardTitle>
            <CardDescription>Current distribution</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {statusData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No project data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {statusData.map((entry) => <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)" }} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest actions across the platform</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.recentActivity.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-3">
                  <Avatar className="h-8 w-8"><AvatarFallback>{initials(a.user.name)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-medium">{a.user.name}</span>{" "}
                      <span className="text-muted-foreground">{a.action.toLowerCase()}d a {a.entity.toLowerCase()}</span>
                      {a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(a.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          View full reports <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
