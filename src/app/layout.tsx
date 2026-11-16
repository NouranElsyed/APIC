import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { SplashLoader } from "@/components/shared/splash-loader";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "SteelFlow ERP — Core Platform",
  description: "SteelFlow ERP Phase 1: projects, customers, documents & reporting foundation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <SessionProvider>
          <SplashLoader />
          {children}
          <Toaster position="top-right" />
        </SessionProvider>
      </body>
    </html>
  );
}
