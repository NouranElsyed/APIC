// DXF Nesting tab — embeds the standalone Nest Boost tool (public/nest-boost.html).
// The old engine-based nesting (jobs / runs / assisted editor) was removed.
export default function NestingPage() {
  return (
    <iframe
      src="/nest-boost.html"
      title="Nest Boost — DXF nesting"
      className="h-[calc(100vh-14rem)] min-h-[700px] w-full rounded-xl border border-border bg-card"
    />
  );
}
