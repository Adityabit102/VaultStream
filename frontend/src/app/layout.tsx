import type { Metadata } from "next";
import { Fraunces, Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { RoleProvider } from "@/components/RoleProvider";
import { ThemeProvider, themeNoFlashScript } from "@/components/ThemeProvider";
import { NotificationProvider } from "@/components/NotificationProvider";
import { ToastProvider } from "@/components/ToastProvider";
import CommandPalette from "@/components/site/CommandPalette";
import ShortcutsHelp from "@/components/site/ShortcutsHelp";
import CardTilt from "@/components/site/CardTilt";
import VaultAssistant from "@/components/VaultAssistant";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const TITLE = "VaultStream — Real-Time Fraud Intelligence";
const DESCRIPTION =
  "Streaming fraud detection and decisioning for modern financial institutions. Sub-30ms scoring, explainable ML, a live analyst command center, and an in-app Model Lab.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "VaultStream",
  keywords: ["fraud detection", "machine learning", "XGBoost", "real-time", "streaming", "risk"],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "VaultStream",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <RoleProvider>
              <NotificationProvider>
                <ToastProvider>
                  <CommandPalette />
                  <ShortcutsHelp />
                  <CardTilt />
                  {children}
                  <VaultAssistant />
                </ToastProvider>
              </NotificationProvider>
            </RoleProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
