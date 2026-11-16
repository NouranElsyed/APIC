"use client";
import * as React from "react";

const MIN_MS = 3000; // minimum time the splash stays visible
const FADE_MS = 500;

/**
 * Full-screen splash shown on first load.
 * Stays at least MIN_MS; if the page needs longer to load it waits for it,
 * and if it loads faster it keeps showing until MIN_MS has passed.
 */
export function SplashLoader() {
  const [phase, setPhase] = React.useState<"show" | "fade" | "gone">("show");

  React.useEffect(() => {
    let cancelled = false;
    const minTimer = new Promise<void>((r) => setTimeout(r, MIN_MS));
    const loaded = new Promise<void>((r) => {
      if (document.readyState === "complete") r();
      else window.addEventListener("load", () => r(), { once: true });
    });
    Promise.all([minTimer, loaded]).then(() => {
      if (cancelled) return;
      setPhase("fade");
      setTimeout(() => !cancelled && setPhase("gone"), FADE_MS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (phase === "gone") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8 bg-white"
      style={{
        opacity: phase === "fade" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === "fade" ? "none" : "auto",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/atec-apic-logo.png"
        alt="ATEC APIC — Engineering Solutions Together"
        className="splash-logo w-[min(80vw,520px)] h-auto select-none"
        draggable={false}
      />
      <div className="splash-bar h-1 w-[min(60vw,260px)] overflow-hidden rounded-full bg-slate-200">
        <div className="splash-bar-fill h-full rounded-full bg-[#0a2a5e]" />
      </div>
    </div>
  );
}
