import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Colony Wi-Fi",
  description: "Fast, affordable Wi-Fi. Pay with M-Pesa.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
