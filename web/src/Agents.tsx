import { useEffect, useState } from "react";
import { useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import { isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { useApp, useTx, useWallet } from "./context";
import { fmt, useVault } from "./vault";
import { TxStatus } from "./ui";
import { agentMessage, agentPublic, agentSecret, openSealedKey, sealKeyFor, sealNote } from "./crypto";
import { GRANTED, REVOKED, reason, scan } from "./chain";
import { ERC20_ABI } from "./swap";
import { short } from "./ConnectSheet";
import script from "../public/mnemo-agent.mjs?raw";

const ZERO_KEY = `0x${"0".repeat(64)}`;

export function Agents() {
  return (
    <div className="stack-lg">
      <h1 className="h-page">Agents</h1>
      <RegisterKey />
      <Grants />
      <WriteAsAgent />
      <Docs />
    </div>
  );
}

/** The agent secret is derived from one signature, so the same wallet always gets the same key. */
function useAgentSecret() {
  const config = useConfig();
  const { address } = useWallet();
  return async () => {
    if (!address) throw new Error("Connect a wallet first.");
    const message = agentMessage(address);
    const signature = await signMessage(config, { account: address, message });
    const signer = await recoverMessageAddress({ message, signature });
    if (signer.toLowerCase() !== address.toLowerCase()) throw new Error("Agent keys work with ordinary wallets (EOAs) only.");
    return agentSecret(signature);
  };
}

function RegisterKey() {
  const { d, client, tick } = useApp();
  const { address, chainOk } = useWallet();
  const tx = useTx();
  const derive = useAgentSecret();
  const [current, setCurrent] = useState<Hex | null>(null);
  useEffect(() => {
    if (!address) return setCurrent(null);
    (client.readContract({ address: d.vault.address, abi: d.vault.abi, functionName: "keyOf", args: [address] }) as Promise<Hex>)
      .then(setCurrent)
      .catch(() => setCurrent(null));
  }, [address, client, d, tick]);
  return (
    <section className="panel" aria-labelledby="reg-title">
      <h2 id="reg-title">Register an agent key</h2>
      <p className="hint">Publishes this wallet's x25519 public key so vault owners can seal their key to it. The secret is derived from one signature and never leaves the browser.</p>
      <p className="hint num">Registered key: {current === null ? "connect to see it" : current === ZERO_KEY ? "none" : short(current)}</p>
      <button
        className="btn btn-primary"
        disabled={!chainOk}
        onClick={async () => {
          try {
            tx.setState({ kind: "wallet", text: "Sign to derive your agent key" });
            const pub = agentPublic(await derive());
            await tx.send("Register key", { address: d.vault.address, abi: d.vault.abi, functionName: "register", args: [pub] });
          } catch (e) {
            tx.fail(reason(e));
          }
        }}
      >
        Register my key
      </button>
      {!chainOk && <p className="hint">Connect on {d.chain.name} to register.</p>}
      <TxStatus state={tx.state} />
    </section>
  );
}

function Grants() {
  const { d, client, tick } = useApp();
  const { address, chainOk } = useWallet();
  const v = useVault();
  const tx = useTx();
  const [agent, setAgent] = useState("");
  const [granted, setGranted] = useState<Address[]>([]);
  useEffect(() => {
    if (!address) return setGranted([]);
    (async () => {
      // Only this wallet's own grants are read.
      const [g, r] = await Promise.all([
        scan(client, d.vault.address, GRANTED, { owner: address }, d.fromBlock),
        scan(client, d.vault.address, REVOKED, { owner: address }, d.fromBlock),
      ]);
      const agents = [...new Set([...g, ...r].map((l) => String(l.args.agent)))] as Address[];
      const live = await Promise.all(
        agents.map((a) => client.readContract({ address: d.vault.address, abi: d.vault.abi, functionName: "isGranted", args: [address, a] }) as Promise<boolean>),
      );
      setGranted(agents.filter((_, i) => live[i]));
    })().catch(() => setGranted([]));
  }, [address, client, d, tick]);

  const grant = async (a: string) => {
    if (!isAddress(a)) return tx.fail("Enter the agent's full 0x address.");
    if (address && a.toLowerCase() === address.toLowerCase()) return tx.fail("A vault cannot grant itself.");
    const k = v.key();
    if (!k) return tx.fail("Open your vault first: the grant carries your current vault key, sealed to the agent.");
    const pub = (await client.readContract({ address: d.vault.address, abi: d.vault.abi, functionName: "keyOf", args: [a] })) as Hex;
    if (pub === ZERO_KEY) return tx.fail("That wallet has not registered an agent key yet. Ask it to register first.");
    await tx.send(`Grant ${short(a)}`, { address: d.vault.address, abi: d.vault.abi, functionName: "grant", args: [a, sealKeyFor(pub, k)] });
  };

  return (
    <section className="panel" aria-labelledby="grant-title">
      <h2 id="grant-title">Grant or revoke an agent</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          grant(agent);
        }}
      >
        <label htmlFor="agent">Agent wallet address</label>
        <div className="inline">
          <input id="agent" autoComplete="off" spellCheck={false} value={agent} onChange={(e) => setAgent(e.target.value.trim())} />
          <button className="btn btn-primary" type="submit" disabled={!chainOk || v.status !== "open"}>
            Grant
          </button>
        </div>
        <p className="hint">{v.status === "open" ? "A granted agent can read notes from your current epoch on and write into your vault, paying the stamp itself." : "Open your vault on the home page to grant: the grant carries your current vault key."}</p>
      </form>
      <h3>Granted agents</h3>
      {granted.length === 0 ? (
        <p className="hint">{address ? "No agents granted." : "Connect to see your grants."}</p>
      ) : (
        <ul className="list">
          {granted.map((a) => (
            <li key={a} className="list-row">
              <span className="num">{short(a)}</span>
              <span className="row-actions">
                <button className="btn btn-sm" disabled={!chainOk || v.status !== "open"} onClick={() => grant(a)}>
                  Re-seal key
                </button>
                <button className="btn btn-sm" disabled={!chainOk} onClick={() => tx.send(`Revoke ${short(a)}`, { address: d.vault.address, abi: d.vault.abi, functionName: "revoke", args: [a] })}>
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Revoking also rotates your key epoch. Re-seal your key for the agents you keep so they can read new notes.</p>
      <TxStatus state={tx.state} />
    </section>
  );
}

function WriteAsAgent() {
  const { d, client } = useApp();
  const { address, chainOk } = useWallet();
  const tx = useTx();
  const derive = useAgentSecret();
  const [owner, setOwner] = useState("");
  const [text, setText] = useState("");
  const go = async () => {
    try {
      if (!address) return tx.fail("Connect a wallet first.");
      if (!isAddress(owner)) return tx.fail("Enter the vault owner's full 0x address.");
      const vault = d.vault;
      const [ok, epoch, stamp, balance, allowance] = await Promise.all([
        client.readContract({ address: vault.address, abi: vault.abi, functionName: "isGranted", args: [owner, address] }) as Promise<boolean>,
        client.readContract({ address: vault.address, abi: vault.abi, functionName: "epochOf", args: [owner] }) as Promise<number>,
        client.readContract({ address: vault.address, abi: vault.abi, functionName: "stamp" }) as Promise<bigint>,
        client.readContract({ address: d.token.address, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
        client.readContract({ address: d.token.address, abi: ERC20_ABI, functionName: "allowance", args: [address, vault.address] }),
      ]);
      if (!ok) return tx.fail(`${short(owner)} has not granted this wallet.`);
      const grants = await scan(client, vault.address, GRANTED, { owner, agent: address }, d.fromBlock);
      const latest = grants.filter((g) => Number(g.args.epoch) === Number(epoch)).pop();
      if (!latest) return tx.fail(`The owner has not sealed their epoch ${epoch} key to you yet. Ask them to re-seal.`);
      tx.setState({ kind: "wallet", text: "Sign to derive your agent key" });
      const key = openSealedKey(await derive(), latest.args.sealedKey as Hex);
      if (!key) return tx.fail("The sealed key does not open with this wallet's agent key. Register again and ask the owner to re-seal.");
      if (balance < stamp) return tx.fail(`Writing costs ${fmt(stamp)} MNEMO and this wallet holds ${fmt(balance)}.`);
      if (allowance < stamp) {
        const approved = await tx.send(`Allow the vault to burn ${fmt(stamp)} MNEMO`, { address: d.token.address, abi: ERC20_ABI, functionName: "approve", args: [vault.address, stamp] });
        if (!approved) return;
      }
      if (await tx.send("Write note as agent", { address: vault.address, abi: vault.abi, functionName: "writeFor", args: [owner, [sealNote(key, text)], Number(epoch)] })) setText("");
    } catch (e) {
      tx.fail(reason(e));
    }
  };
  return (
    <section className="panel" aria-labelledby="wf-title">
      <h2 id="wf-title">Write as a granted agent</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label htmlFor="wf-owner">Vault owner address</label>
        <input id="wf-owner" autoComplete="off" spellCheck={false} value={owner} onChange={(e) => setOwner(e.target.value.trim())} />
        <label htmlFor="wf-text">Note</label>
        <textarea id="wf-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="form-foot">
          <span className="hint">The stamp is paid from this wallet's MNEMO.</span>
          <button className="btn btn-primary" type="submit" disabled={!chainOk || !text.trim()}>
            Write note
          </button>
        </div>
      </form>
      <TxStatus state={tx.state} />
    </section>
  );
}

function Docs() {
  return (
    <section className="panel" aria-labelledby="docs-title">
      <h2 id="docs-title">For agent builders</h2>
      <p className="hint">
        The full scheme is in <a href="./llms.txt">llms.txt</a>. This script reads and writes a vault you were granted (Node 22, viem and noble).{" "}
        <a href="./mnemo-agent.mjs" download>
          Download mnemo-agent.mjs
        </a>
      </p>
      <pre className="code" tabIndex={0} aria-label="mnemo-agent.mjs">
        <code>{script}</code>
      </pre>
    </section>
  );
}
