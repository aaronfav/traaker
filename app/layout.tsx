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
          <div className="min-h-screen bg-[#05070d] text-slate-100">
            <header className="sticky top-0 z-40 border-b border-slate-800/70 bg-[#05070d]/92 shadow-[0_10px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              <div className="mx-auto flex w-full max-w-[118rem] items-center justify-between gap-4 px-5 py-4 sm:px-7 lg:px-10">
                <div className="flex items-center gap-8">
                  <Link href="/" className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-50">
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
                      <span className="h-4 w-4 rotate-45 rounded-[4px] border-2 border-cyan-300 border-r-blue-500 border-t-blue-500" />
                    </span>
                    Traak
                  </Link>
                  <nav className="hidden items-center gap-8 text-base font-semibold text-slate-400 md:flex">
                    <Link className="border-b-2 border-cyan-300 px-1 py-2 text-slate-100 transition hover:text-slate-50" href="/">
                      Markets
                    </Link>
                    <Link className="px-1 py-2 transition hover:text-slate-100" href="/portfolio">
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
