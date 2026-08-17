"use client";
import { Menu, Bell } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, cn } from "@/lib/utils";
import { RoleBadge } from "@/components/shared/status-badge";
import { signOutAction } from "@/features/auth/actions";
import { useNotificationStream } from "@/hooks/use-notification-stream";

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Topbar({
  title,
  subtitle,
  user,
  onToggleSidebar,
}: {
  title: string;
  subtitle?: string;
  user: { name: string; email: string; role: string };
  onToggleSidebar?: () => void;
}) {
  const { notifications, unreadCount, connected, markAllRead } = useNotificationStream();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onToggleSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" title={connected ? "Live" : "Reconnecting…"}>
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card",
                  connected ? "bg-emerald-500" : "bg-muted-foreground/50"
                )}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                {connected ? "Live" : "Reconnecting…"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">No activity yet.</p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className="flex flex-col gap-0.5 px-2 py-2 text-sm hover:bg-secondary rounded-md">
                    <span className="text-foreground">{n.message}</span>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(n.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-secondary">
              <Avatar>
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight text-foreground">{user.name}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{user.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center justify-between">
              Signed in as <RoleBadge role={user.role} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOutAction()}>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
