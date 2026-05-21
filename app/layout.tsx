import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { WalletConnectButton } from "@/components/WalletConnectButton";
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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <div className="min-h-screen bg-slate-950 text-slate-100">
            <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
              <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
                <div className="flex items-center gap-5">
                  <Link href="/" className="text-base font-semibold tracking-wide text-slate-100">
                    Traak
                  </Link>
                  <nav className="hidden items-center gap-1 text-sm text-slate-400 md:flex">
                    <Link className="rounded-md px-3 py-2 transition hover:bg-slate-900 hover:text-slate-100" href="/">
                      Markets
                    </Link>
                    <Link className="rounded-md px-3 py-2 transition hover:bg-slate-900 hover:text-slate-100" href="/portfolio">
                      Portfolio
                    </Link>
                  </nav>
                </div>
                <WalletConnectButton />
              </div>
            </header>
            {children}
            <footer className="border-t border-slate-800/80 px-4 py-6 text-xs text-slate-500 sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p>
                  Prediction markets involve risk. Users can lose money. Traak is non-custodial, not financial advice, and geographic restrictions may apply.
                </p>
                <div className="flex gap-4 text-slate-500">
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
