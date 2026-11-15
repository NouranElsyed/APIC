// Call at the start of anything that READS a project's Part List (material usage, production, nesting jobs, BOQ):
// it first brings the Part List in step with the project's 2D nest, so nobody works from stale quantities, and
// nobody has to remember to press "Sync with nest". Best effort — a failure never stops the read — and throttled,
// because one page can ask several times within the same second.

const lastRun = new Map<string, number>();
const running = new Map<string, Promise<void>>();
const THROTTLE_MS = 5000;

export async function ensureNestInSync(projectId: string): Promise<void> {
  const inflight = running.get(projectId);
  if (inflight) return inflight;
  if (Date.now() - (lastRun.get(projectId) ?? 0) < THROTTLE_MS) return;
  const job = (async () => {
    try {
      const { auth } = await import("@/server/auth/config");
      const userId = (await auth())?.user?.id;
      if (!userId) return;
      const { syncBeforeUse } = await import("./nest-sync.service");
      await syncBeforeUse(projectId, userId);
    } catch (e) {
      console.error("[nest-sync] sync before use failed", e);
    } finally {
      lastRun.set(projectId, Date.now());
      running.delete(projectId);
    }
  })();
  running.set(projectId, job);
  return job;
}

/** Forget the throttle (after an edit, or in tests). */
export const resetNestSyncThrottle = (projectId?: string) => (projectId ? lastRun.delete(projectId) : lastRun.clear());
