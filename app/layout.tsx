import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
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
      className={`${manrope.variable} ${cormorantGaramond.variable} bg-[#030813]`}
    >
      <body
        className={`${manrope.className} m-0 min-h-screen bg-[#030813] p-0 text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
