import { useEffect, useRef, useState } from "react";
import { ConnectSheet } from "./ConnectSheet";
import { Faq, Hero, Numbers, OwnerPanel, VaultPanel } from "./Home";
import { Chat } from "./Chat";
import { Agents } from "./Agents";
import { Trade } from "./Trade";
import { AnyModel, ChainBoundary, Footer, ForAgents, HowItWorks, SampleNote } from "./Story";

const ROUTES = [
  { hash: "#/", label: "Vault" },
  { hash: "#/chat", label: "Chat" },
  { hash: "#/agents", label: "Agents" },
  { hash: "#/trade", label: "Trade" },
];

/** Hash routing, so the export works from any gateway path without server rewrites. */
function useRoute() {
  const get = () => (ROUTES.some((r) => r.hash === location.hash) ? location.hash : "#/");
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  return (
    <>
      <a className="skip" href={route} onClick={(e) => {
        e.preventDefault();
        main.current?.focus({ preventScroll: true });
        main.current?.scrollIntoView({ block: "start", behavior: "instant" });
      }}>
        Skip to content
      </a>
      <header className="top">
        <a className="brand" href="#/">
          MNEMO
        </a>
        <nav aria-label="Sections">
          {ROUTES.map((r) => (
            <a key={r.hash} href={r.hash} aria-current={route === r.hash ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <ConnectSheet />
      </header>
      <main ref={main} id="main" tabIndex={-1}>
        {route === "#/" && (
          <>
            <Hero />
            <VaultPanel />
            <OwnerPanel />
            <HowItWorks />
            <SampleNote />
            <AnyModel />
            <ChainBoundary />
            <ForAgents />
            <Numbers />
            <Faq />
          </>
        )}
        {route === "#/chat" && <Chat />}
        {route === "#/agents" && <Agents />}
        {route === "#/trade" && <Trade />}
      </main>
      <Footer />
    </>
  );
}
