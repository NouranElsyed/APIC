export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#16345c,_#0b1a30_60%)] p-4">
      {children}
    </div>
  );
}
