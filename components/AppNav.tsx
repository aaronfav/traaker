"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { useTraakTheme } from "@/components/Providers";

function navLinkClass(active: boolean) {
  return [
    "relative px-1 py-2 text-base font-semibold transition duration-200",
    active ? "text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]",
    "after:absolute after:inset-x-0 after:-bottom-[17px] after:h-0.5 after:rounded-full after:bg-cyan-300 after:shadow-[0_0_16px_rgba(34,211,238,0.9)] after:transition after:duration-200",
    active ? "after:opacity-100" : "after:opacity-0 hover:after:opacity-50",
  ].join(" ");
}

export function AppNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTraakTheme();
  const portfolioActive = pathname.startsWith("/portfolio");
  const marketsActive = !portfolioActive;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] shadow-[0_14px_42px_rgba(0,0,0,0.36)] backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-[118rem] items-center justify-between gap-4 px-5 py-3.5 sm:px-7 lg:px-10">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-3 text-2xl font-bold tracking-tight text-[var(--foreground)]" aria-label="Traak home">
            <Image
              src="/traak-original-logo.jpg"
              alt=""
              width={40}
              height={40}
              priority
              className="h-10 w-10 rounded-full bg-white object-contain shadow-[0_0_18px_rgba(37,99,235,0.38)]"
            />
            <span>Traak</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
            <Link className={navLinkClass(marketsActive)} href="/">
              Markets
            </Link>
            <Link className={navLinkClass(portfolioActive)} href="/portfolio">
              Portfolio
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-lg shadow-black/20 transition hover:border-cyan-300/40 hover:bg-[var(--surface-2)]"
            onClick={toggleTheme}
            type="button"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
