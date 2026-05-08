import type { Metadata } from "next";
import { Providers } from "@/components/auth/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "bkstr | Compressed Knowledge for AI Agents",
  description:
    "Domain expertise compressed into structured, machine-first formats for internal AI agent fleets.",
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
