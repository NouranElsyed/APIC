/** Steel-structure photo anchored to the bottom of the sidebar, fading into the sidebar colour. */
export function SidebarBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 top-[38%] overflow-hidden">
      <div className="absolute inset-0 bg-cover bg-bottom opacity-90" style={{ backgroundImage: "url(/sidebar-bg.webp)" }} />
      <div className="absolute inset-0 bg-gradient-to-b from-sidebar via-sidebar/60 to-sidebar/10" />
    </div>
  );
}
