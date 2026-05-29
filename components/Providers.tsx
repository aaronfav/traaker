"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

type TraakTheme = "dark" | "light";

type ThemeContextValue = {
  theme: TraakTheme;
  setTheme: (theme: TraakTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTraakTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: "dark" as TraakTheme,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return context;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [theme, setThemeState] = useState<TraakTheme>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem("traak-theme");
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("traak-theme", theme);
  }, [theme]);

  const themeContext = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggleTheme: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider value={themeContext}>
          <RainbowKitProvider
            modalSize="compact"
            theme={
              theme === "light"
                ? lightTheme({
                    accentColor: "#0891b2",
                    accentColorForeground: "#f8fafc",
                    borderRadius: "small",
                    fontStack: "system",
                  })
                : darkTheme({
                    accentColor: "#22d3ee",
                    accentColorForeground: "#020617",
                    borderRadius: "small",
                    fontStack: "system",
                  })
            }
          >
            {children}
          </RainbowKitProvider>
        </ThemeContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
