import type { Metadata } from "next";
import { Geist_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ONPE Bot",
  description: "Recibe resultados presidenciales de ONPE por WhatsApp.",
};

export const viewport = {
  colorScheme: "dark",
  themeColor: "#111111",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html
        lang="es"
        className={`${spaceGrotesk.variable} ${geistMono.variable} h-full`}
      >
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
        <Analytics />
      </body>
      </html>
  );
}
