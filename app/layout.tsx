import type { Metadata } from "next";
import localFont from "next/font/local";

import "./fonts/cormorant-garamond.css";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/manrope-variable.ttf",
  weight: "400 700",
  style: "normal",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "WAIA",
    template: "%s | WAIA",
  },
  description: "Open AI infrastructure for humans, businesses and society.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${manrope.variable} bg-[#030813]`}>
      <body
        className={`${manrope.className} text-foreground m-0 min-h-screen bg-[#030813] p-0 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
