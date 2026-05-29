"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";

export function WalletConnectButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-4 text-sm font-bold text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.1)] transition hover:border-cyan-200/70 hover:bg-cyan-300/15"
              onClick={openConnectModal}
              type="button"
            >
              Connect
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-amber-300/45 bg-amber-300/12 px-4 text-sm font-bold text-amber-100 transition hover:bg-amber-300/18"
              onClick={openChainModal}
              type="button"
            >
              Switch to Polygon
            </button>
          );
        }

        return (
          <button
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--foreground)] shadow-lg shadow-black/20 transition hover:border-cyan-300/40 hover:bg-[var(--surface-2)]"
            onClick={openAccountModal}
            type="button"
          >
            <span className="hidden h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.95)] sm:block" />
            <span className="max-w-32 truncate">{account.displayName}</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
