import { useEffect, useState } from "react";
import { useApp, useSwitchChain, useTx, useWallet } from "./context";
import { Capsule } from "./Capsule";
import { fmt, useVault, type Note } from "./vault";
import { TxStatus, Unscramble } from "./ui";
import { MAX_PLAINTEXT_BYTES, plaintextBytes } from "./crypto";
import { countVaults } from "./chain";
import { explorerAddress } from "./config";
import { short } from "./ConnectSheet";
import { parseUnits, isAddress, type Address } from "viem";

export function Hero() {
  const { d, setConnectOpen } = useApp();
  const { connected, chainOk } = useWallet();
  const sw = useSwitchChain();
  const v = useVault();
  const isOpen = v.status === "open";
  const busy = v.status === "signing" || v.status === "loading";

  let action = (
    <button className="btn btn-primary btn-lg" onClick={() => setConnectOpen(true)}>
      Open your vault
    </button>
  );
  if (connected && !chainOk)
    action = (
      <button className="btn btn-primary btn-lg" onClick={sw.run} disabled={sw.busy}>
        Switch to {d.chain.name}
      </button>
    );
  else if (connected && !isOpen)
    action = (
      <button className="btn btn-primary btn-lg" onClick={v.open} disabled={busy}>
        {v.status === "signing" ? "Sign in your wallet…" : v.status === "loading" ? "Reading your notes…" : "Open your vault"}
      </button>
    );
  else if (isOpen)
    action = (
      <a className="btn btn-primary btn-lg" href="#/chat">
        Chat with your memory
      </a>
    );

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">Your AI's memory, sealed on chain</h1>
        <p className="lede">Notes are encrypted in your browser, kept on Ethereum as ciphertext, and loaded into any model you choose.</p>
        <div className="hero-action">
          {action}
          <p className="hint">{isOpen ? `Vault open · ${v.notes.length} notes` : "One signature opens it. Ordinary wallets (EOAs) only."}</p>
        </div>
        {(v.error || sw.error) && (
          <p className="note-err" role="alert">
            {v.error || sw.error}
          </p>
        )}
      </div>
      <Capsule sealed={isOpen} />
    </section>
  );
}

export function VaultPanel() {
  const { d } = useApp();
  const v = useVault();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: bigint; text: string } | null>(null);
  if (v.status !== "open") return null;
  const r = v.reads;
  const bytes = plaintextBytes(draft);
  const readable = v.notes.filter((n) => n.text !== null);
  const locked = v.notes.length - readable.length;
  return (
    <section className="panel" aria-labelledby="vault-title">
      <div className="panel-head">
        <h2 id="vault-title">Your vault</h2>
        <div className="row-actions">
          <button className="btn" onClick={v.exportJson} disabled={readable.length === 0}>
            Export JSON
          </button>
          <button className="btn" onClick={v.rotate}>
            Rotate key
          </button>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Key epoch</dt>
          <dd className="num">{r ? r.epoch : "…"}</dd>
        </div>
        <div>
          <dt>Stamp per note</dt>
          <dd className="num">{r ? `${fmt(r.stamp)} MNEMO` : "…"}</dd>
        </div>
        <div>
          <dt>Your MNEMO</dt>
          <dd className="num">{r ? fmt(r.balance) : "…"}</dd>
        </div>
      </dl>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const submitted = draft;
          if (await v.seal([submitted])) setDraft((current) => current === submitted ? "" : current);
        }}
      >
        <label htmlFor="new-note">New note</label>
        <textarea id="new-note" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="form-foot">
          <span className={`hint num ${bytes > MAX_PLAINTEXT_BYTES ? "over" : ""}`}>
            {bytes} / {MAX_PLAINTEXT_BYTES} bytes
          </span>
          <button className="btn btn-primary" type="submit" disabled={!draft.trim() || v.sealing || v.tx.state.kind === "wallet" || v.tx.state.kind === "pending"}>
            {v.sealing ? "Sealing note…" : `Seal note${r ? ` · ${fmt(r.stamp)} MNEMO` : ""}`}
          </button>
        </div>
      </form>
      <TxStatus state={v.tx.state} />
      <h3>Notes</h3>
      {v.notes.length === 0 ? (
        <p className="hint">No notes yet. Write one above, or chat and approve what the model proposes to remember.</p>
      ) : (
        <ul className="notes">
          {v.notes.map((n) => (
            <NoteRow key={n.id.toString()} n={n} editing={editing} setEditing={setEditing} />
          ))}
        </ul>
      )}
      {locked > 0 && <p className="hint">{locked} notes were sealed under a key this signature cannot open.</p>}
      <p className="hint">
        Vault contract{" "}
        <a href={explorerAddress(d, d.vault.address)} target="_blank" rel="noreferrer" className="num">
          {short(d.vault.address)}
        </a>
      </p>
    </section>
  );
}

function NoteRow({
  n,
  editing,
  setEditing,
}: {
  n: Note;
  editing: { id: bigint; text: string } | null;
  setEditing: (e: { id: bigint; text: string } | null) => void;
}) {
  const v = useVault();
  const isEditing = editing?.id === n.id;
  return (
    <li className="note">
      <div className="note-meta num">
        #{n.id.toString()} · epoch {n.epoch}
      </div>
      {isEditing ? (
        <div className="stack">
          <label htmlFor={`edit-${n.id}`}>Edit note #{n.id.toString()}</label>
          <textarea id={`edit-${n.id}`} rows={3} value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} />
          <div className="row-actions">
            <button
              className="btn btn-primary"
              disabled={v.sealing || v.tx.state.kind === "wallet" || v.tx.state.kind === "pending"}
              onClick={async () => {
                if (await v.edit(n.id, editing.text)) setEditing(null);
              }}
            >
              Seal edit
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <p className="hint">Two steps: seal the new text, then forget #{n.id.toString()}.</p>
        </div>
      ) : (
        <>
          <p className="note-text">{n.text === null ? <span className="cipher">{n.ciphertext.slice(2, 66)}</span> : <Unscramble text={n.text} from={n.ciphertext.slice(52)} />}</p>
          <div className="row-actions">
            {n.text !== null && (
              <button className="btn btn-sm" onClick={() => setEditing({ id: n.id, text: n.text! })}>
                Edit
              </button>
            )}
            <button className="btn btn-sm" onClick={() => v.forget([n.id])}>
              Forget
            </button>
          </div>
        </>
      )}
    </li>
  );
}

export function Numbers() {
  const { d, client, tick } = useApp();
  const [n, setN] = useState<{ notes: bigint; burned: bigint; vaults: number | null; stamp: bigint } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    const v = d.vault;
    Promise.all([
      client.readContract({ address: v.address, abi: v.abi, functionName: "notesTotal" }) as Promise<bigint>,
      client.readContract({ address: v.address, abi: v.abi, functionName: "burnedTotal" }) as Promise<bigint>,
      client.readContract({ address: v.address, abi: v.abi, functionName: "stamp" }) as Promise<bigint>,
    ])
      .then(async ([notes, burned, stamp]) => {
        if (!live) return;
        setN({ notes, burned, stamp, vaults: null });
        const vaults = await countVaults(client, v.address, d.fromBlock).catch(() => null);
        if (live) setN({ notes, burned, stamp, vaults });
      })
      .catch(() => live && setErr("Network totals are unavailable: the public RPCs did not answer. Reload to try again."));
    return () => {
      live = false;
    };
  }, [client, d, tick]);
  return (
    <section className="panel" aria-labelledby="numbers-title">
      <h2 id="numbers-title">Network totals</h2>
      {err ? (
        <p className="note-err">{err}</p>
      ) : (
        <dl className="facts">
          <div>
            <dt>Notes sealed</dt>
            <dd className="num">{n ? n.notes.toLocaleString("en-US") : "…"}</dd>
          </div>
          <div>
            <dt>MNEMO burned</dt>
            <dd className="num">{n ? fmt(n.burned) : "…"}</dd>
          </div>
          <div>
            <dt>Vaults opened</dt>
            <dd className="num">{n?.vaults != null ? n.vaults.toLocaleString("en-US") : "…"}</dd>
          </div>
          <div>
            <dt>Stamp per note</dt>
            <dd className="num">{n ? `${fmt(n.stamp)} MNEMO` : "…"}</dd>
          </div>
        </dl>
      )}
      <p className="hint">Totals only. MNEMO never lists other wallets or their notes. Vaults opened counts wallets that sealed at least one note.</p>
    </section>
  );
}

/** Launch owner's settings: the stamp, and two-step ownership transfer. Hidden from everyone else. */
export function OwnerPanel() {
  const { d, client, tick } = useApp();
  const { address, chainOk } = useWallet();
  const tx = useTx();
  const [roles, setRoles] = useState<{ owner: Address; pending: Address } | null>(null);
  const [stamp, setStamp] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    const v = d.vault;
    Promise.all([
      client.readContract({ address: v.address, abi: v.abi, functionName: "owner" }) as Promise<Address>,
      client.readContract({ address: v.address, abi: v.abi, functionName: "pendingOwner" }) as Promise<Address>,
    ])
      .then(([owner, pending]) => setRoles({ owner, pending }))
      .catch(() => setRoles(null));
  }, [client, d, tick]);
  if (!address || !roles) return null;
  const me = address.toLowerCase();
  const isOwner = roles.owner.toLowerCase() === me;
  const isPending = roles.pending.toLowerCase() === me;
  if (!isOwner && !isPending) return null;
  const v = d.vault;
  return (
    <section className="panel" aria-labelledby="owner-title">
      <h2 id="owner-title">Owner settings</h2>
      {isPending && (
        <button className="btn btn-primary" disabled={!chainOk} onClick={() => tx.send("Accept ownership", { address: v.address, abi: v.abi, functionName: "acceptOwnership" })}>
          Accept ownership
        </button>
      )}
      {isOwner && (
        <>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(stamp);
              if (!(n >= 100 && n <= 100000)) return tx.fail("Set a stamp between 100 and 100,000 MNEMO per note.");
              tx.send("Set stamp", { address: v.address, abi: v.abi, functionName: "setStamp", args: [parseUnits(stamp, 18)] });
            }}
          >
            <label htmlFor="stamp">Stamp per note, in MNEMO (100 to 100,000; applies to future writes)</label>
            <div className="inline">
              <input id="stamp" inputMode="decimal" value={stamp} onChange={(e) => setStamp(e.target.value)} />
              <button className="btn" type="submit" disabled={!chainOk}>
                Set stamp
              </button>
            </div>
          </form>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isAddress(to)) return tx.fail("Enter the new owner's full 0x address.");
              tx.send("Start ownership transfer", { address: v.address, abi: v.abi, functionName: "transferOwnership", args: [to] });
            }}
          >
            <label htmlFor="new-owner">New owner address (they must accept)</label>
            <div className="inline">
              <input id="new-owner" autoComplete="off" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value.trim())} />
              <button className="btn" type="submit" disabled={!chainOk}>
                Transfer
              </button>
            </div>
          </form>
        </>
      )}
      <TxStatus state={tx.state} />
    </section>
  );
}

export function Faq() {
  const qa: [string, string][] = [
    ["What is on chain?", "Ciphertext only. Each note is encrypted in your browser with XChaCha20-Poly1305 before it is sent; the vault contract stores it as an event and never sees plaintext or keys."],
    ["Who sees my prompts?", "The model provider you pick, directly from your browser. MNEMO runs no server and proxies nothing. With a model on your own computer, nobody else sees them."],
    ["What do forget and rotate do?", "Forget marks a note as gone so the site stops loading it, but the old ciphertext stays on chain. Rotate moves your vault to a new key epoch: later notes are sealed under a new key, so an agent you revoked cannot read them."],
    ["Which wallets work?", "Ordinary wallets (EOAs) only. Your vault key is derived from a wallet signature, and smart contract wallets do not sign the same way twice."],
    ["What does a note cost?", "Every note you seal burns the current stamp in MNEMO, 2,000 at launch, sent to the burn address in the same transaction."],
    ["What happens when I change models?", "Your conversation, draft and proposed notes stay in this tab as you move between pages. Changing providers or endpoints clears the active API key. If you choose Remember on this device, saved keys are kept separately for each provider and origin; you can explicitly load the matching key again."],
    ["Can I try it without a wallet?", "Yes. Unseal the local sample above, or open Chat with your own model endpoint. A wallet is needed to open your vault and seal notes on Ethereum. Chat messages and prompts are never published on chain."],
  ];
  return (
    <section className="panel" aria-labelledby="faq-title">
      <h2 id="faq-title">Questions</h2>
      {qa.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}
