import { useApp, useSwitchChain, useWallet } from "./context";
import { fmt, useVault } from "./vault";
import { TxStatus } from "./ui";
import { useChat } from "./chat-state";
import { PROVIDERS, type ProviderId } from "./chat-model";
export { askModel, splitReply, systemPrompt } from "./chat-model";

export function Chat() {
  const { d, setConnectOpen } = useApp();
  const { connected, chainOk } = useWallet();
  const sw = useSwitchChain();
  const v = useVault();
  const { provider, base, model, key, remember, pick, setBase, setModel, setKey, setRemember,
    canLoadKey, loadKey, storageError, messages, input, setInput, busy, err, proposals, setProposals, send } = useChat();
  const memories = v.notes.filter((n) => n.text !== null).map((n) => n.text!);
  const chosen = proposals.filter((p) => p.on && p.text.trim());
  const stamp = v.reads?.stamp;
  const opening = v.status === "signing" || v.status === "loading";
  return (
    <div className="chat-grid">
      <section className="panel" aria-labelledby="chat-title">
        <h1 id="chat-title" className="h-page">
          Chat
        </h1>
        <div className="provider">
          <div className="stack">
            <label htmlFor="provider">Provider</label>
            <select id="provider" value={provider} onChange={(e) => pick(e.target.value as ProviderId)}>
              {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </div>
          <div className="stack">
            <label htmlFor="model">Model</label>
            <input id="model" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          {(provider === "compatible" || provider === "local") && (
            <div className="stack wide">
              <label htmlFor="base">{provider === "local" ? "Your model server's address (OpenAI-compatible API)" : "Endpoint base URL (ends before /chat/completions)"}</label>
              <input id="base" type="url" value={base} onChange={(e) => setBase(e.target.value.trim())} autoComplete="off" spellCheck={false} />
              <p className="hint">Your server must allow browser requests from this site's origin.</p>
            </div>
          )}
          <div className="stack wide">
            <label htmlFor="key">API key{PROVIDERS[provider].keyRequired ? "" : " (if your server needs one)"}</label>
            <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
            <p className="hint">Keys stay in this tab unless remembered. Saved keys belong to a provider and origin. Changing provider or endpoint clears the active key.</p>
            {canLoadKey && <button className="btn btn-sm" type="button" onClick={loadKey}>Use saved key for this origin</button>}
            {storageError && <p className="note-err" role="alert">{storageError}</p>}
          </div>
        </div>

        <ol className="convo" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 && <li className="hint">Ask anything. Your open vault's notes are sent to the model as context.</li>}
          {messages.map((m, i) => (
            <li key={i} className={`msg msg-${m.role}`}>
              <span className="who">{m.role === "user" ? "You" : model}</span>
              <p>{m.content}</p>
            </li>
          ))}
        </ol>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="msg">Message</label>
          <textarea
            id="msg"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
            }}
          />
          <div className="form-foot">
            <span className="hint">Ctrl+Enter sends</span>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Waiting for the model…" : "Send"}
            </button>
          </div>
          {err && (
            <p className="note-err" role="alert">
              {err}
            </p>
          )}
        </form>

        {proposals.length > 0 && (
          <div className="proposals" aria-labelledby="prop-title">
            <h2 id="prop-title">Remember this?</h2>
            {proposals.map((p, i) => (
              <div key={i} className="proposal">
                <input
                  type="checkbox"
                  aria-label={`Keep proposal ${i + 1}`}
                  checked={p.on}
                  onChange={(e) => setProposals(proposals.map((q, j) => (j === i ? { ...q, on: e.target.checked } : q)))}
                />
                <textarea
                  aria-label={`Proposal ${i + 1}`}
                  rows={2}
                  value={p.text}
                  onChange={(e) => setProposals(proposals.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))}
                />
              </div>
            ))}
            {v.status === "open" ? (
              <>
                <p className="hint num">
                  Sealing {chosen.length} note{chosen.length === 1 ? "" : "s"} burns {stamp !== undefined ? `${fmt(stamp * BigInt(chosen.length))} MNEMO` : "the stamp"}.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={chosen.length === 0 || v.sealing || !chainOk}
                  onClick={async () => {
                    if (await v.seal(chosen.map((c) => c.text))) setProposals([]);
                  }}
                >
                  {v.sealing ? "Sealing notes…" : `Seal ${chosen.length} note${chosen.length === 1 ? "" : "s"}`}
                </button>
              </>
            ) : (
              <p className="hint">Open your vault in the “What MNEMO remembers” panel to seal these notes here.</p>
            )}
          </div>
        )}
        <TxStatus state={v.tx.state} />
      </section>

      <aside className="panel side" aria-labelledby="mem-title">
        <h2 id="mem-title">What MNEMO remembers</h2>
        {v.status !== "open" ? (
          <>
            <p className="hint">Your vault is closed. Open it to load your notes into the chat.</p>
            <button className="btn" disabled={opening || sw.busy} onClick={() => {
              if (!connected) setConnectOpen(true);
              else if (!chainOk) sw.run();
              else v.open();
            }}>
              {!connected ? "Connect to open your vault" : !chainOk ? `Switch to ${d.chain.name}` : v.status === "signing" ? "Sign in your wallet…" : v.status === "loading" ? "Reading your notes…" : "Open your vault"}
            </button>
            <p className="hint">One signature. Your conversation stays here.</p>
            {(v.error || sw.error) && <p className="note-err" role="alert">{v.error || sw.error}</p>}
          </>
        ) : memories.length === 0 ? (
          <p className="hint">Nothing yet. Approve a proposal after a reply to seal your first note.</p>
        ) : (
          <ul className="mem">
            {memories.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
