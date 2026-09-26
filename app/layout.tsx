import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CurveForge — Meteora DBC Launch Studio",
  description:
    "Configure, simulate and ship Meteora Dynamic Bonding Curve launches. Curve presets, exact migration math and live DBC pool inspection.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
