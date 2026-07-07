import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@/components/cloudstream/common/QueryClientProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CloudStream Web",
  description: "CloudStream for Web — extension-based media center",
  keywords: [
    "CloudStream",
    "streaming",
    "media center",
    "extensions",
    "anime",
    "movies",
    "tv series",
  ],
  authors: [{ name: "recloudstream" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "CloudStream Web",
    description: "CloudStream for Web — extension-based media center",
    siteName: "CloudStream Web",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "CloudStream Web",
    description: "CloudStream for Web — extension-based media center",
  },
};

/**
 * Root layout for CloudStream Web.
 *
 * The base background + text color are set on `<body>` via inline style so the
 * CloudStream Material3 Dark palette (`#1e1e1e` bg / `#ffffff` text) is
 * applied before any client component mounts — this avoids a white flash on
 * first paint. The runtime `<ThemeProvider>` (mounted in page.tsx) will
 * override these values when the user has picked a non-dark theme.
 *
 * Card surfaces use `#2d2d2d` and borders `#3d3d3d`; these are applied per-
 * component rather than globally so individual cards can opt out if needed.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ backgroundColor: "#1e1e1e", color: "#ffffff" }}
      >
        <QueryClientProvider>{children}</QueryClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
