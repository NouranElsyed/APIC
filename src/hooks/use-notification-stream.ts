"use client";
import { useEffect, useRef, useState, useCallback } from "react";

export interface LiveNotification {
  id: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const MAX_NOTIFICATIONS = 30;
const RECONNECT_DELAY_MS = 3000;

export function useNotificationStream() {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const source = new EventSource("/api/notifications/stream");
      sourceRef.current = source;

      source.addEventListener("connected", () => {
        setConnected(true);
      });

      source.addEventListener("notification", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setNotifications((prev) => {
          const next: LiveNotification[] = [
            { ...data, read: false },
            ...prev,
          ];
          return next.slice(0, MAX_NOTIFICATIONS);
        });
      });

      source.addEventListener("ping", () => {
        // Keep-alive only, no state change needed.
      });

      source.onerror = () => {
        setConnected(false);
        source.close();
        if (!cancelled) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, connected, markAllRead };
}
