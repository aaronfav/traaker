"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletConnectButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button
              className="h-9 rounded-md bg-cyan-400 px-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
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
              className="h-9 rounded-md bg-amber-400 px-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
              onClick={openChainModal}
              type="button"
            >
              Switch to Polygon
            </button>
          );
        }

        return (
          <button
            className="h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-100 transition hover:bg-slate-800"
            onClick={openAccountModal}
            type="button"
          >
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
