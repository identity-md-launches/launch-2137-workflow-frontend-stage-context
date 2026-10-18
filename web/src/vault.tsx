/**
 * The open vault: the signature that derives every epoch's key (kept in memory only), the
 * caller's decrypted notes, and the vault's write actions.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import { formatUnits, recoverMessageAddress, type Address, type Hex } from "viem";
import { useApp, useTx, useWallet } from "./context";
import { openNote, sealNote, vaultKey, vaultMessage } from "./crypto";
import { readNotes, reason } from "./chain";
import { ERC20_ABI } from "./swap";

export type Note = { id: bigint; epoch: number; text: string | null; ciphertext: Hex };

export type Reads = { epoch: number; stamp: bigint; balance: bigint; allowance: bigint } | null;

type VaultCtx = {
  status: "closed" | "signing" | "loading" | "open" | "error";
  error: string;
  notes: Note[];
  reads: Reads;
  open: () => Promise<void>;
  close: () => void;
  key: () => Uint8Array | null;
  reload: () => Promise<void>;
  tx: ReturnType<typeof useTx>;
  seal: (texts: string[]) => Promise<boolean>;
  sealing: boolean;
  forget: (ids: bigint[]) => Promise<boolean>;
  rotate: () => Promise<boolean>;
  edit: (id: bigint, text: string) => Promise<boolean>;
  exportJson: () => void;
};

const Ctx = createContext<VaultCtx | null>(null);

export const fmt = (v: bigint, decimals = 18, max = 2) => {
  const [i, f = ""] = formatUnits(v, decimals).split(".");
  const int = BigInt(i).toLocaleString("en-US");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
};

export function VaultProvider({ children }: { children: ReactNode }) {
  const { d, client, tick } = useApp();
  const config = useConfig();
  const { address, chainOk } = useWallet();
  const tx = useTx();
  const [sig, setSig] = useState<{ owner: Address; sig: Hex } | null>(null);
  const [status, setStatus] = useState<VaultCtx["status"]>("closed");
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [reads, setReads] = useState<Reads>(null);
  const sealLock = useRef(false);
  const [sealing, setSealing] = useState(false);

  // A vault belongs to one address: switching accounts closes it and forgets the signature.
  useEffect(() => {
    if (sig && sig.owner !== address) {
      setSig(null);
      setNotes([]);
      setStatus("closed");
    }
  }, [address, sig]);

  const loadReads = useCallback(async () => {
    if (!address) return setReads(null);
    const v = d.vault;
    const [epoch, stamp, balance, allowance] = await Promise.all([
      client.readContract({ address: v.address, abi: v.abi, functionName: "epochOf", args: [address] }) as Promise<number>,
      client.readContract({ address: v.address, abi: v.abi, functionName: "stamp" }) as Promise<bigint>,
      client.readContract({ address: d.token.address, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      client.readContract({ address: d.token.address, abi: ERC20_ABI, functionName: "allowance", args: [address, v.address] }),
    ]);
    setReads({ epoch: Number(epoch), stamp, balance, allowance });
  }, [address, client, d]);

  const loadNotes = useCallback(
    async (s: { owner: Address; sig: Hex }) => {
      const logs = await readNotes(client, d.vault.address, s.owner, d.fromBlock);
      const keys = new Map<number, Uint8Array>();
      setNotes(
        logs.map((l) => {
          if (!keys.has(l.epoch)) keys.set(l.epoch, vaultKey(s.sig, l.epoch));
          return { ...l, text: openNote(keys.get(l.epoch)!, l.ciphertext) };
        }),
      );
    },
    [client, d],
  );

  useEffect(() => {
    loadReads().catch(() => setReads(null));
  }, [loadReads, tick]);

  useEffect(() => {
    if (sig && status === "open") loadNotes(sig).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const open = useCallback(async () => {
    if (!address || !chainOk) return;
    setError("");
    try {
      setStatus("signing");
      const message = vaultMessage(address);
      const signature = await signMessage(config, { account: address, message });
      const signer = await recoverMessageAddress({ message, signature });
      if (signer.toLowerCase() !== address.toLowerCase()) {
        throw new Error("This wallet signs as a smart contract account. MNEMO vault keys work with ordinary wallets (EOAs) only.");
      }
      const s = { owner: address, sig: signature };
      setStatus("loading");
      await loadNotes(s);
      setSig(s);
      setStatus("open");
    } catch (e) {
      setError(reason(e));
      setStatus("error");
    }
  }, [address, chainOk, config, loadNotes]);

  const close = useCallback(() => {
    setSig(null);
    setNotes([]);
    setStatus("closed");
  }, []);

  const key = useCallback(() => (sig && reads ? vaultKey(sig.sig, reads.epoch) : null), [sig, reads]);

  const seal = useCallback(
    async (texts: string[]) => {
      // The ref closes the same-event double-click gap; state disables every Seal control.
      if (sealLock.current || tx.state.kind === "wallet" || tx.state.kind === "pending") return false;
      const clean = texts.map((t) => t.trim()).filter(Boolean);
      const k = key();
      if (!k || !reads) {
        tx.fail("Open your vault before sealing notes.");
        return false;
      }
      if (clean.length === 0 || clean.length > 16) {
        tx.fail("Seal between 1 and 16 notes at a time.");
        return false;
      }
      let sealed: Hex[];
      try {
        sealed = clean.map((t) => sealNote(k, t));
      } catch (e) {
        tx.fail(reason(e));
        return false;
      }
      const cost = reads.stamp * BigInt(clean.length);
      if (reads.balance < cost) {
        tx.fail(`Sealing costs ${fmt(cost)} MNEMO and this wallet holds ${fmt(reads.balance)}. Buy MNEMO on the Trade tab.`);
        return false;
      }
      sealLock.current = true;
      setSealing(true);
      try {
        if (reads.allowance < cost) {
          const ok = await tx.send(`Allow the vault to burn ${fmt(cost)} MNEMO`, {
            address: d.token.address,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [d.vault.address, cost],
          });
          if (!ok) return false;
        }
        return await tx.send(`Seal ${clean.length} note${clean.length === 1 ? "" : "s"}`, {
          address: d.vault.address,
          abi: d.vault.abi,
          functionName: "write",
          args: [sealed, reads.epoch],
        });
      } finally {
        // Approval and write are one flow. Release only after a receipt or a failure.
        sealLock.current = false;
        setSealing(false);
      }
    },
    [key, reads, tx, d],
  );

  const forget = useCallback(
    (ids: bigint[]) => tx.send(`Forget ${ids.length} note${ids.length === 1 ? "" : "s"}`, { address: d.vault.address, abi: d.vault.abi, functionName: "forget", args: [ids] }),
    [tx, d],
  );

  const rotate = useCallback(() => tx.send("Rotate vault key", { address: d.vault.address, abi: d.vault.abi, functionName: "rotate" }), [tx, d]);

  const edit = useCallback(
    async (id: bigint, text: string) => {
      // The chain keeps ciphertext forever, so an edit seals the new text, then forgets the old id.
      if (!(await seal([text]))) return false;
      return forget([id]);
    },
    [seal, forget],
  );

  const exportJson = useCallback(() => {
    if (!address) return;
    const data = {
      vault: d.vault.address,
      chainId: d.chain.id,
      owner: address,
      exportedAt: new Date().toISOString(),
      notes: notes.filter((n) => n.text !== null).map((n) => ({ id: n.id.toString(), epoch: n.epoch, text: n.text })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mnemo-${address.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [address, notes, d]);

  const reload = useCallback(async () => {
    await loadReads();
    if (sig) await loadNotes(sig);
  }, [loadReads, loadNotes, sig]);

  return (
    <Ctx.Provider value={{ status, error, notes, reads, open, close, key, reload, tx, seal, sealing, forget, rotate, edit, exportJson }}>{children}</Ctx.Provider>
  );
}

export function useVault() {
  const c = useContext(Ctx);
  if (!c) throw new Error("VaultProvider missing");
  return c;
}
