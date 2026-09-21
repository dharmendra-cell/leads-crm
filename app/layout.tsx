import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Lead CRM", description: "Upload lead sheets, call, track, ask." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
