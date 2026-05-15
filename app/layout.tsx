import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";

import "./globals.css";

const fontWaiaSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-waia-ui-sans",
  display: "swap",
});

const fontWaiaSerif = Source_Serif_4({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600"],
  variable: "--font-waia-brand-serif",
  display: "swap",
});

const fontWaiaMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-waia-ui-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "WAIA",
    template: "%s | WAIA",
  },
  description:
    "Open AI infrastructure for humans, businesses and society.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontWaiaSans.variable} ${fontWaiaSerif.variable} ${fontWaiaMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
