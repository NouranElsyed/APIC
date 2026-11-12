// Tiny fetch helper for the planning endpoints (JSON in, `{ error }` out).
export async function planApi<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof json?.error === "string" ? json.error : "Request failed" };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Network error — please try again." };
  }
}
