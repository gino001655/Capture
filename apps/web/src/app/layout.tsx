import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Capture System",
  description: "Capture now. Process locally. Use the result anywhere.",
  applicationName: "Personal Capture",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Capture",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#247554",
  colorScheme: "light",
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
