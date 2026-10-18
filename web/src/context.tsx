import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import type { Abi, Address, Hex, PublicClient } from "viem";
import type { Deployment } from "./config";
import { reason } from "./chain";

type AppCtx = {
  d: Deployment;
  client: PublicClient;
  connectOpen: boolean;
  setConnectOpen: (v: boolean) => void;
  /** Bumped after every confirmed transaction so reads refresh. */
  tick: number;
  bump: () => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ d, client, children }: { d: Deployment; client: PublicClient; children: ReactNode }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  return <Ctx.Provider value={{ d, client, connectOpen, setConnectOpen, tick, bump }}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

/** Connected address and whether the wallet is on the deployment's chain. */
export function useWallet() {
  const { d } = useApp();
  const { address, isConnected, chainId, connector } = useAccount();
  return { address: isConnected ? address : undefined, connected: isConnected, chainOk: isConnected && chainId === d.chain.id, connector };
}

/** Switch chains; when the wallet does not know the chain, add it from walletAddChain, then switch. */
export function useSwitchChain() {
  const { d } = useApp();
  const { connector } = useAccount();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (!connector) return;
    setBusy(true);
    setError("");
    const hexId = `0x${d.chain.id.toString(16)}`;
    try {
      const provider = (await connector.getProvider()) as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch (e) {
        const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
        const unknown = code === 4902 || /unrecognized|unknown chain|not added/i.test(String((e as Error).message));
        if (!unknown || !d.file.walletAddChain) throw e;
        await provider.request({ method: "wallet_addEthereumChain", params: [d.file.walletAddChain] });
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      }
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }, [connector, d]);
  return { run, error, busy };
}

export type TxState = { kind: "idle" | "wallet" | "pending" | "done" | "error"; text: string; hash?: Hex };

export type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };

/** Simulate, ask the wallet, wait for the receipt; each step is visible in `state`. */
export function useTx() {
  const config = useConfig();
  const { bump, client } = useApp();
  const { address } = useAccount();
  const [state, setState] = useState<TxState>({ kind: "idle", text: "" });
  const active = useRef(false);
  const send = useCallback(
    async (label: string, call: Call): Promise<boolean> => {
      if (active.current) return false;
      if (!address) {
        setState({ kind: "error", text: "Connect a wallet first." });
        return false;
      }
      active.current = true;
      try {
        setState({ kind: "wallet", text: `${label}: checking the call` });
        const { request } = await simulateContract(config, { ...call, account: address } as never);
        setState({ kind: "wallet", text: `${label}: confirm in your wallet` });
        let hash = await writeContract(config, request as never);
        setState({ kind: "pending", text: `${label}: waiting for the block`, hash });
        for (;;) {
          let receipt;
          let replacement: "repriced" | "replaced" | "cancelled" | undefined;
          try {
            // Read the raw receipt: wagmi's wrapper throws on a reverted receipt too.
            // Only a receipt (including a mined replacement) establishes the outcome.
            receipt = await client.waitForTransactionReceipt({
              hash,
              timeout: 60_000,
              onReplaced: ({ reason, transactionReceipt }) => {
                hash = transactionReceipt.transactionHash;
                replacement = reason;
              },
            });
          } catch {
            // A timeout or RPC failure says nothing about a broadcast transaction.
            // Keep send() unresolved so the full approval/write seal lock stays held.
            setState({ kind: "pending", text: `${label}: confirmation unavailable; still checking this transaction. Keep this tab open.`, hash });
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          hash = receipt.transactionHash;
          if (replacement === "cancelled" || replacement === "replaced") {
            setState({ kind: "error", text: `${label}: ${replacement === "cancelled" ? "cancelled" : "replaced by a different transaction"} in your wallet.`, hash });
            bump();
            return false;
          }
          if (receipt.status !== "success") {
            setState({ kind: "error", text: `${label}: reverted on chain.`, hash });
            return false;
          }
          setState({ kind: "done", text: `${label}: confirmed`, hash });
          bump();
          return true;
        }
      } catch (e) {
        const message = reason(e);
        setState({ kind: "error", text: `${label}: ${message === "unknown reason" ? "Transaction failed. Check your wallet and try again." : message}` });
        return false;
      } finally {
        active.current = false;
      }
    },
    [address, config, bump, client],
  );
  const fail = useCallback((text: string) => setState({ kind: "error", text }), []);
  const reset = useCallback(() => setState({ kind: "idle", text: "" }), []);
  return { state, send, fail, reset, setState };
}
