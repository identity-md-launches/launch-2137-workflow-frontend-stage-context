import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/spline-sans-mono/latin-400.css";
import "@fontsource/spline-sans-mono/latin-500.css";
import "./styles.css";
import { loadDeployment, makePublicClient, makeWagmiConfig } from "./config";
import { AppProvider } from "./context";
import { VaultProvider } from "./vault";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);

loadDeployment()
  .then((d) => {
    const config = makeWagmiConfig(d);
    const client = makePublicClient(d);
    root.render(
      <StrictMode>
        <WagmiProvider config={config}>
          <QueryClientProvider client={new QueryClient()}>
            <AppProvider d={d} client={client}>
              <VaultProvider>
                <App />
              </VaultProvider>
            </AppProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </StrictMode>,
    );
  })
  .catch((e) => {
    root.render(
      <main id="main" className="boot-err">
        <h1>MNEMO could not start</h1>
        <p>{e instanceof Error ? e.message : String(e)}</p>
      </main>,
    );
  });
