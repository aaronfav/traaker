"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const config = walletConnectProjectId
  ? getDefaultConfig({
      appName: "Traak Sports Terminal",
      projectId: walletConnectProjectId,
      chains: [polygon],
      ssr: true,
    })
  : createConfig({
      chains: [polygon],
      connectors: [injected()],
      ssr: true,
      transports: {
        [polygon.id]: http(),
      },
    });

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({
            accentColor: "#22d3ee",
            accentColorForeground: "#020617",
            borderRadius: "small",
            fontStack: "system",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
