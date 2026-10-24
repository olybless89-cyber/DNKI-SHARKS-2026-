import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SHARKS International Convergence — Accreditation", template: "%s — DNKI SHARKS" },
  description: "Member registration and accreditation for the DNKI SHARKS International Convergence.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:p-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
