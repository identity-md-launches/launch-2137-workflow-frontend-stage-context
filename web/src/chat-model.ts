export type ProviderId = "anthropic" | "openai" | "compatible" | "local";
export type Msg = { role: "user" | "assistant"; content: string };

export const PROVIDERS: Record<ProviderId, { label: string; base: string; model: string; keyRequired: boolean }> = {
  anthropic: { label: "Anthropic", base: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", keyRequired: true },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4.1", keyRequired: true },
  compatible: { label: "OpenAI-compatible endpoint", base: "", model: "", keyRequired: false },
  local: { label: "Model on your computer", base: "", model: "", keyRequired: false },
};

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

export function splitReply(text: string): { reply: string; proposals: string[] } {
  const m = text.match(/<remember>([\s\S]*?)<\/remember>/i);
  if (!m) return { reply: text.trim(), proposals: [] };
  const proposals = m[1].split("\n").map((l) => l.replace(/^[-*\s]+/, "").trim()).filter(Boolean).slice(0, 16);
  return { reply: text.replace(m[0], "").trim(), proposals };
}

/** The key belongs to this exact provider/endpoint pair, even when two paths share an origin. */
export type Credential = { provider: ProviderId; base: string; value: string };
export function endpointOrigin(base: string): string | null {
  try {
    const url = new URL(base);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export async function askModel(p: { provider: ProviderId; base: string; model: string; key: string; system: string; messages: Msg[] }): Promise<string> {
  if (!endpointOrigin(p.base)) throw new Error("Enter a complete http:// or https:// model endpoint without a username or password.");
  const base = p.base.replace(/\/+$/, "");
  if (p.provider === "anthropic") {
    const r = await fetch(`${base}/messages`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: p.model, max_tokens: 1024, system: p.system, messages: p.messages }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message ?? `The provider answered HTTP ${r.status}.`);
    return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (p.key) headers.authorization = `Bearer ${p.key}`;
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", redirect: "error", headers,
    body: JSON.stringify({ model: p.model, messages: [{ role: "system", content: p.system }, ...p.messages] }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message ?? `The provider answered HTTP ${r.status}.`);
  return j?.choices?.[0]?.message?.content ?? "";
}
