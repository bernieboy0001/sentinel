import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SENTINEL — self-auditing autonomous fund",
  description:
    "A crypto agent that trades a live on-chain market, records every decision in an append-only ledger, commits it on-chain, and re-scores itself on outcomes."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}