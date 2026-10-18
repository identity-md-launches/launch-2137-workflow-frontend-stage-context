import { useEffect, useState } from "react";
import type { TxState } from "./context";
import { useApp } from "./context";
import { explorerTx } from "./config";

/** One status line for a transaction flow: wallet prompt, pending hash, confirmation or error. */
export function TxStatus({ state }: { state: TxState }) {
  const { d } = useApp();
  return (
    <p className={`tx tx-${state.kind}`} role="status" aria-live="polite">
      {state.kind === "idle" ? "" : state.text}
      {state.hash && explorerTx(d, state.hash) && (
        <>
          {" "}
          <a href={explorerTx(d, state.hash)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </>
      )}
    </p>
  );
}

const GLYPHS = "0123456789abcdef";

export function CopyButton({ text, label, name }: { text: string; label: string; name?: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  return <span className="copy-control">
    <button className="btn btn-sm" aria-label={name && state === "done" ? `${name}, copied` : name} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setState("done"); }
      catch { setState("error"); }
    }}>{state === "done" ? "Copied" : label}</button>
    <span className={state === "error" ? "note-err" : "sr-only"} role="status">{state === "done" ? `${name ?? label}: copied to clipboard.` : state === "error" ? "Copy unavailable. Select and copy the text." : ""}</span>
  </span>;
}

/** Ciphertext that unscrambles into the note's words once, when the vault opens. */
export function Unscramble({ text, from }: { text: string; from: string }) {
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduce ? text : scrambled(from, text.length));
  useEffect(() => {
    if (reduce) return setShown(text);
    let frame = 0;
    const total = 24;
    const id = setInterval(() => {
      frame++;
      const done = Math.floor((frame / total) * text.length);
      setShown(text.slice(0, done) + scrambled(from.slice(done * 2), text.length - done));
      if (frame >= total) {
        clearInterval(id);
        setShown(text);
      }
    }, 30);
    return () => clearInterval(id);
  }, [text, from, reduce]);
  return <span aria-label={text}>{shown}</span>;
}

function scrambled(hex: string, n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += hex[i] ?? GLYPHS[(i * 7) % 16];
  return s;
}
