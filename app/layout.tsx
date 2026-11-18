import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MICROGALAXY — личная обсерватория",
  description: "Наблюдайте за историей одной звёздной системы: планеты, цивилизации и первые шаги в космос.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
