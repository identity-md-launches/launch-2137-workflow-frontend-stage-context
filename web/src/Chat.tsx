import { useEffect, useState } from "react";
import { useApp } from "./context";
import { fmt, useVault } from "./vault";
import { TxStatus } from "./ui";

/**
 * Chat goes straight from this browser to the provider the visitor picks. The site ships no
 * private or local addresses: a self-hosted or local model is reached at the address the visitor
 * types in.
 */
type ProviderId = "anthropic" | "openai" | "compatible" | "local";
const PROVIDERS: Record<ProviderId, { label: string; base: string; model: string; keyRequired: boolean }> = {
  anthropic: { label: "Anthropic", base: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", keyRequired: true },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4.1", keyRequired: true },
  compatible: { label: "OpenAI-compatible endpoint", base: "", model: "", keyRequired: false },
  local: { label: "Model on your computer", base: "", model: "", keyRequired: false },
};

type Msg = { role: "user" | "assistant"; content: string };
const STORE = "mnemo.chat.v1";

export function systemPrompt(memories: string[]) {
  const known = memories.length ? memories.map((m) => `- ${m}`).join("\n") : "(nothing yet)";
  return [
    "You are a helpful assistant. The user keeps a private, encrypted memory that only they can open.",
    `What you remember about the user:\n${known}`,
    "After your answer, if the user said something worth remembering in later conversations, end with a block",
    "<remember>\none short fact per line\n</remember>",
    "Leave the block out when there is nothing new. Never repeat facts already remembered.",
  ].join("\n\n");
}

/** Splits the reply into what to show and the notes the model proposes to remember. */
export function splitReply(text: string): { reply: string; proposals: string[] } {
  const m = text.match(/<remember>([\s\S]*?)<\/remember>/i);
  if (!m) return { reply: text.trim(), proposals: [] };
  const proposals = m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 16);
  return { reply: text.replace(m[0], "").trim(), proposals };
}

export async function askModel(p: { provider: ProviderId; base: string; model: string; key: string; system: string; messages: Msg[] }): Promise<string> {
  const base = p.base.replace(/\/+$/, "");
  if (p.provider === "anthropic") {
    const r = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": p.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: p.model, max_tokens: 1024, system: p.system, messages: p.messages }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message ?? `The provider answered HTTP ${r.status}.`);
    return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (p.key) headers.authorization = `Bearer ${p.key}`;
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: p.system }, ...p.messages] }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message ?? `The provider answered HTTP ${r.status}.`);
  return j?.choices?.[0]?.message?.content ?? "";
}

export function Chat() {
  const { setConnectOpen } = useApp();
  const v = useVault();
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? "null") as { provider: ProviderId; base: string; model: string; key: string } | null;
    } catch {
      return null;
    }
  })();
  const [provider, setProvider] = useState<ProviderId>(saved?.provider ?? "anthropic");
  const [base, setBase] = useState(saved?.base ?? PROVIDERS.anthropic.base);
  const [model, setModel] = useState(saved?.model ?? PROVIDERS.anthropic.model);
  const [key, setKey] = useState(saved?.key ?? "");
  const [remember, setRemember] = useState(!!saved);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proposals, setProposals] = useState<{ text: string; on: boolean }[]>([]);

  useEffect(() => {
    if (remember) localStorage.setItem(STORE, JSON.stringify({ provider, base, model, key }));
    else localStorage.removeItem(STORE);
  }, [remember, provider, base, model, key]);

  const pick = (id: ProviderId) => {
    setProvider(id);
    setBase(PROVIDERS[id].base);
    setModel(PROVIDERS[id].model);
  };

  const memories = v.notes.filter((n) => n.text !== null).map((n) => n.text!);
  const chosen = proposals.filter((p) => p.on && p.text.trim());
  const stamp = v.reads?.stamp;

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (!base) return setErr("Enter the address of your model server.");
    if (!model) return setErr("Enter the model name.");
    if (PROVIDERS[provider].keyRequired && !key) return setErr(`Enter your ${PROVIDERS[provider].label} API key.`);
    setErr("");
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const out = await askModel({ provider, base, model, key, system: systemPrompt(memories), messages: next });
      const { reply, proposals: p } = splitReply(out);
      setMessages([...next, { role: "assistant", content: reply || "(empty reply)" }]);
      setProposals(p.map((t) => ({ text: t, on: true })));
    } catch (e) {
      setErr(`Unable to reach the model: ${e instanceof Error ? e.message : String(e)} Check the address, model and key.`);
    } finally {
      setBusy(false);
    }
  };

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
            </div>
          )}
          <div className="stack wide">
            <label htmlFor="key">API key{PROVIDERS[provider].keyRequired ? "" : " (if your server needs one)"}</label>
            <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
            <p className="hint">Without it, the key lives in this tab's memory only. Requests go from your browser straight to the provider.</p>
          </div>
        </div>

        <ol className="convo" aria-label="Conversation">
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
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
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
                  disabled={chosen.length === 0}
                  onClick={async () => {
                    if (await v.seal(chosen.map((c) => c.text))) setProposals([]);
                  }}
                >
                  Seal {chosen.length} note{chosen.length === 1 ? "" : "s"}
                </button>
                <TxStatus state={v.tx.state} />
              </>
            ) : (
              <p className="hint">Open your vault on the home page to seal these.</p>
            )}
          </div>
        )}
      </section>

      <aside className="panel side" aria-labelledby="mem-title">
        <h2 id="mem-title">What MNEMO remembers</h2>
        {v.status !== "open" ? (
          <>
            <p className="hint">Your vault is closed. Open it to load your notes into the chat.</p>
            <a className="btn" href="#/" onClick={() => setConnectOpen(false)}>
              Go to your vault
            </a>
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
