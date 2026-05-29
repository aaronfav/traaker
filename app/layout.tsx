import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Providers } from "@/components/Providers";
import { AppNav } from "@/components/AppNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Traak Sports Terminal",
  description: "Polymarket sports trading terminal and analytics layer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Script id="traak-theme-init" strategy="beforeInteractive">{`
          try {
            var stored = window.localStorage.getItem('traak-theme');
            var theme = stored === 'light' ? 'light' : 'dark';
            document.documentElement.dataset.theme = theme;
          } catch (error) {}
        `}</Script>
        <Providers>
          <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
            <AppNav />
            {children}
            <footer className="border-t border-[var(--border)] px-4 py-6 text-xs text-[var(--muted)] sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p>
                  Prediction markets involve risk. Users can lose money. Traak is non-custodial, not financial advice, and geographic restrictions may apply.
                </p>
                <div className="flex gap-4 text-[var(--muted)]">
                  <span>Terms</span>
                  <span>Privacy</span>
                  <span>Risk Disclosure</span>
                </div>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
