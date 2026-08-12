import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Capture System",
  description: "Capture now. Process locally. Use the result anywhere.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
