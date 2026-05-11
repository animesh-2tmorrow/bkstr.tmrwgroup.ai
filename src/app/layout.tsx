import type { Metadata } from "next";
import { Providers } from "@/components/auth/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "bkstr | Compressed Knowledge for AI Agents",
  description:
    "Domain expertise compressed into structured, machine-first formats for internal AI agent fleets.",
  // Phase 5 Stream C / D14.7 — TMRW Group brand attribution. Source assets in
  // `public/favicon*` + `public/apple-touch-icon.png`. Sizes 16/32/192/512
  // (plus the legacy multi-size .ico) cover all standard browser tab + PWA
  // surfaces; apple-touch-icon covers iOS home-screen pinning.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/favicon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
