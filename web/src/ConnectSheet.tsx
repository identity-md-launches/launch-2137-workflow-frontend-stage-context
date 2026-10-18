import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import { WALLET_ICONS } from "./wallet-icons";
import { useApp, useSwitchChain, useWallet } from "./context";
import { reason } from "./chain";

/**
 * Mobile without a relay: a phone browser has no extension, so the sheet offers to open this page
 * inside a wallet's own browser, where that wallet is injected. Each link is the one its vendor
 * documents; none needs a project ID or a server.
 */
export const OPEN_IN: ReadonlyArray<{ id: string; name: string; href: (url: string) => string }> = [
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks
  { id: "metamask", name: "MetaMask", href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  // https://docs.cdp.coinbase.com/wallet-sdk/docs/deep-link
  { id: "coinbase", name: "Coinbase Wallet", href: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  // https://docs.phantom.com/phantom-deeplinks/other-methods/browse
  { id: "phantom", name: "Phantom", href: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
];

/** A phone or tablet browser with no injected provider is the case the links exist for. */
export const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as unknown as { ethereum?: unknown }).ethereum;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const iconSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** The connect control: one button that connects, switches chains, or shows the address. */
export function ConnectSheet() {
  const { d, connectOpen: open, setConnectOpen: setOpen } = useApp();
  const mobile = isMobileBrowser();
  const { address, isConnected } = useAccount();
  const { chainOk } = useWallet();
  const sw = useSwitchChain();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    reset();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const targets = sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        if (!targets?.length) return;
        const first = targets[0], last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    addEventListener("keydown", onKey);
    sheet.current?.querySelector<HTMLElement>("button, a")?.focus();
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      removeEventListener("keydown", onKey);
      root?.removeAttribute("inert");
      if (previous?.isConnected) previous.focus();
      else trigger.current?.focus();
    };
  }, [open, setOpen, reset]);
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected, setOpen]);

  // EIP-6963 names each installed extension; wagmi's generic injected row is only for a browser
  // where discovery found nothing, and then it is called what it is.
  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")].filter(
    (c) => !(c.id === "injected" && named),
  );
  const label = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name);
  const icon = (c: Connector) => c.icon ?? (WALLET_ICONS[c.id] ? iconSrc(WALLET_ICONS[c.id]!) : undefined);

  if (isConnected && address && !chainOk) {
    return (
      <div className="connect-wrap">
        <button className="btn btn-primary" onClick={sw.run} disabled={sw.busy}>
          {sw.busy ? "Switching…" : `Switch to ${d.chain.name}`}
        </button>
        {sw.error && (
          <p className="note-err" role="alert">
            {sw.error}
          </p>
        )}
      </div>
    );
  }
  if (isConnected && address) {
    return (
      <div className="connect-wrap">
        <button className="btn" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span className="num">{short(address)}</span>
        </button>
        {menu && (
          <div className="menu">
            <button
              className="btn"
              onClick={() => {
                setMenu(false);
                disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <button ref={trigger} className="btn" onClick={() => setOpen(true)}>
        Connect
      </button>
      {open &&
        createPortal(
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            {mobile &&
              OPEN_IN.map((w) => (
                <a key={w.id} className="row" href={w.href(location.href)}>
                  <span className="ic">
                    <img width={28} height={28} src={iconSrc(WALLET_ICONS[w.id]!)} alt="" />
                  </span>
                  <span>Open in {w.name}</span>
                </a>
              ))}
            {listed
              .filter((c) => !mobile || c.type !== "injected")
              .map((c) => (
                <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
                  <span className="ic">{icon(c) ? <img width={28} height={28} src={icon(c)} alt="" /> : null}</span>
                  <span>
                    {label(c)}
                    {isPending && variables?.connector === c ? " · opening…" : ""}
                  </span>
                </button>
              ))}
            {error && <p className="note-err">{reason(error)}</p>}
            <p className="hint">Vault keys come from a wallet signature, so MNEMO works with ordinary wallets (EOAs) only.</p>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
