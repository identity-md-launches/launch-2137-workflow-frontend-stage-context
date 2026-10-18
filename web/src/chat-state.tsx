import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useVault } from "./vault";
import { askModel, endpointOrigin, PROVIDERS, splitReply, systemPrompt, type Credential, type Msg, type ProviderId } from "./chat-model";

export const CHAT_SETTINGS = "mnemo.chat.v2";
export const CHAT_KEYS = "mnemo.chat.keys.v2";
type Settings = { provider: ProviderId; base: string; model: string };
type KeyStore = Record<string, Partial<Record<ProviderId, string>>>;
type Proposal = { text: string; on: boolean };
type Session = Settings & { credential: Credential | null; remember: boolean };

function readJson<T>(name: string): T | null {
  try { return JSON.parse(localStorage.getItem(name) ?? "null") as T | null; } catch { return null; }
}

function savedKey(provider: ProviderId, base: string) {
  const origin = endpointOrigin(base);
  const value = origin ? readJson<KeyStore>(CHAT_KEYS)?.[origin]?.[provider] : null;
  return typeof value === "string" ? value : "";
}

function initialSession(): Session {
  const saved = readJson<Settings>(CHAT_SETTINGS);
  if (saved && Object.hasOwn(PROVIDERS, saved.provider) && typeof saved.base === "string" && typeof saved.model === "string") {
    const value = savedKey(saved.provider, saved.base);
    return { ...saved, remember: true, credential: value ? { provider: saved.provider, base: saved.base, value } : null };
  }
  return { provider: "anthropic", base: PROVIDERS.anthropic.base, model: PROVIDERS.anthropic.model, remember: false, credential: null };
}

type ChatCtx = {
  provider: ProviderId; base: string; model: string; key: string; remember: boolean;
  pick: (id: ProviderId) => void; setBase: (base: string) => void; setModel: (model: string) => void;
  setKey: (key: string) => void; setRemember: (on: boolean) => void;
  canLoadKey: boolean; loadKey: () => void; storageError: string;
  messages: Msg[]; input: string; setInput: (text: string) => void;
  busy: boolean; err: string; proposals: Proposal[]; setProposals: Dispatch<SetStateAction<Proposal[]>>;
  send: () => Promise<void>;
};
const Ctx = createContext<ChatCtx | null>(null);

/** Tab-only conversation and credentials live above the route switch, including in-flight replies. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(initialSession);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [err, setErr] = useState("");
  const [storageError, setStorageError] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const v = useVault();
  const { provider, base, model, remember, credential } = session;
  const key = credential?.provider === provider && credential.base === base ? credential.value : "";

  useEffect(() => {
    try {
      // Legacy storage held an unscoped key. Never reuse it for a different provider.
      localStorage.removeItem("mnemo.chat.v1");
      if (!remember) {
        localStorage.removeItem(CHAT_SETTINGS);
        localStorage.removeItem(CHAT_KEYS);
      } else {
        localStorage.setItem(CHAT_SETTINGS, JSON.stringify({ provider, base, model }));
        const origin = endpointOrigin(base);
        if (origin && key) {
          const keys = readJson<KeyStore>(CHAT_KEYS) ?? {};
          keys[origin] = { ...keys[origin], [provider]: key };
          localStorage.setItem(CHAT_KEYS, JSON.stringify(keys));
        }
      }
      setStorageError("");
    } catch {
      setStorageError("Device storage is unavailable. Keep this tab open; your key is held in memory.");
    }
  }, [provider, base, model, key, remember]);

  const pick = useCallback((id: ProviderId) => setSession((s) => id === s.provider ? s : ({ ...s, provider: id, base: PROVIDERS[id].base, model: PROVIDERS[id].model, credential: null })), []);
  const setBase = useCallback((base: string) => setSession((s) => base === s.base ? s : ({ ...s, base, credential: null })), []);
  const setModel = useCallback((model: string) => setSession((s) => ({ ...s, model })), []);
  const setRemember = useCallback((remember: boolean) => setSession((s) => ({ ...s, remember })), []);
  const setKey = (value: string) => {
    if (!value && remember) {
      try {
        const origin = endpointOrigin(base);
        const keys = readJson<KeyStore>(CHAT_KEYS) ?? {};
        if (origin && keys[origin]) { delete keys[origin][provider]; localStorage.setItem(CHAT_KEYS, JSON.stringify(keys)); }
      } catch { /* The persistence effect reports unavailable storage. */ }
    }
    setSession((s) => ({ ...s, credential: value ? { provider: s.provider, base: s.base, value } : null }));
  };

  const send = async () => {
    if (sending.current) return;
    const text = input.trim();
    if (!text) return;
    if (!endpointOrigin(base)) return setErr("Enter a complete http:// or https:// model endpoint without a username or password.");
    if (!model.trim()) return setErr("Enter the model name.");
    if (PROVIDERS[provider].keyRequired && !key) return setErr(`Enter your ${PROVIDERS[provider].label} API key.`);
    setErr("");
    const next = [...messages, { role: "user" as const, content: text }];
    const memories = v.notes.filter((n) => n.text !== null).map((n) => n.text!);
    setMessages(next);
    setInput("");
    sending.current = true;
    setBusy(true);
    try {
      const out = await askModel({ provider, base, model, key, system: systemPrompt(memories), messages: next });
      const { reply, proposals: p } = splitReply(out);
      setMessages([...next, { role: "assistant", content: reply || "(empty reply)" }]);
      setProposals(p.map((text) => ({ text, on: true })));
    } catch (e) {
      setErr(`Unable to reach the model: ${e instanceof Error ? e.message : String(e)} Check the address, model and key.`);
    } finally { sending.current = false; setBusy(false); }
  };

  return <Ctx.Provider value={{ provider, base, model, key, remember, pick, setBase, setModel, setKey, setRemember,
    canLoadKey: remember && !key && !!savedKey(provider, base), loadKey: () => setKey(savedKey(provider, base)), storageError,
    messages, input, setInput, busy, err, proposals, setProposals, send }}>{children}</Ctx.Provider>;
}

export function useChat() {
  const value = useContext(Ctx);
  if (!value) throw new Error("ChatProvider missing");
  return value;
}
