import { auth } from "@/server/auth/config";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;

function formatMessage(log: {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  timestamp: Date;
  user: { name: string };
}) {
  const actionLabel: Record<string, string> = {
    CREATE: "created",
    UPDATE: "updated",
    DELETE: "deleted",
    LOGIN: "logged in",
  };
  const verb = actionLabel[log.action] ?? log.action.toLowerCase();
  const entityLabel = log.entity.charAt(0) + log.entity.slice(1).toLowerCase();

  let message = `${log.user.name} ${verb}`;
  if (log.action !== "LOGIN") {
    message += ` ${entityLabel.toLowerCase()}`;
    if (log.detail) message += ` — ${log.detail}`;
  }

  return {
    id: log.id,
    message,
    timestamp: log.timestamp,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let closed = false;
  let lastTimestamp = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Initial handshake so the client knows the connection is live.
      send("connected", { at: new Date().toISOString() });

      const poll = async () => {
        if (closed) return;
        try {
          const newLogs = await prisma.activityLog.findMany({
            where: { timestamp: { gt: lastTimestamp } },
            include: { user: { select: { name: true } } },
            orderBy: { timestamp: "asc" },
            take: 20,
          });

          if (newLogs.length > 0) {
            lastTimestamp = newLogs[newLogs.length - 1].timestamp;
            for (const log of newLogs) {
              send("notification", formatMessage(log));
            }
          } else {
            // Keep the connection alive through proxies/load balancers.
            send("ping", { at: new Date().toISOString() });
          }
        } catch (err) {
          console.error("Notification stream poll error:", err);
        }
      };

      const interval = setInterval(poll, POLL_INTERVAL_MS);

      // Clean up when the client disconnects.
      const cleanup = () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
