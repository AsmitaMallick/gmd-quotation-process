import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import StoreProvider from "./StoreProvider";
import Navbar from "@/components/layout/Navbar";
import { Toaster } from "@gmd/ui/components/sonner";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/layout/ThemeProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GMD One Person Lead Framework",
  description: "A web application for managing quotations in the GMD quotation process.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-screen antialiased overflow-hidden`}
      suppressHydrationWarning
    >
      <body className="h-screen flex flex-col overflow-hidden bg-background">
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="gmd-theme" disableTransitionOnChange>
        <SessionProvider>
          <StoreProvider>
            <Navbar />
            {children}
            <Toaster position="top-right" richColors />
          </StoreProvider>
        </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
