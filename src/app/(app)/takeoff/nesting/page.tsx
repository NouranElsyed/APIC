"use client";
// DXF Nesting tab — embeds the standalone Nest Boost tool (public/nest-boost.html).
// The iframe file is left untouched; the theme is forced to light from here so it
// matches the rest of the app regardless of the OS/browser dark-mode setting.
export default function NestingPage() {
  return (
    <iframe
      src="/nest-boost.html"
      title="Nest Boost — DXF nesting"
      className="h-[calc(100vh-14rem)] min-h-[700px] w-full rounded-xl border border-border bg-card"
      style={{ colorScheme: "light" }}
      onLoad={(e) => {
        try {
          const doc = e.currentTarget.contentDocument;
          if (doc) doc.documentElement.setAttribute("data-theme", "light");
        } catch {
          /* same-origin, should not fail */
        }
      }}
    />
  );
}