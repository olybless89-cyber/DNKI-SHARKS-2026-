import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DNKI Converge 2026 — SHARKS 2026 Delegates Accreditation", template: "%s — DNKI Converge 2026" },
  description:
    "Official delegates registration and accreditation portal for the 18th DNKI Converge — SHARKS 2026 International Converge, 10–13 December 2026.",
  icons: { icon: "/brand/dnki-crest.webp" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0a0a", width: "device-width", initialScale: 1 };

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
