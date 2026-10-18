import { useState } from "react";
import { useApp } from "./context";
import { CopyButton, Unscramble } from "./ui";
import { openNote, sealNote } from "./crypto";
import { explorerAddress } from "./config";
import script from "../public/mnemo-agent.mjs?raw";

function StepDrawing({ step }: { step: 1 | 2 | 3 }) {
  return <svg className="step-drawing" viewBox="0 0 96 72" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {step === 1 ? <>
      <path d="M23 52V17h48v38H23" /><path d="M32 27h21M32 34h32" />
      <path className="signal-stroke" d="m30 49 7-10-2 13 10-9-3 9 12-7 7 3" />
      <path d="m60 14 9-5 7 8" />
    </> : step === 2 ? <>
      <path d="M14 13h57v33H34L22 57V46h-8V13Z" /><path d="M32 53h42l10 8V29h-7" />
      <path d="M25 25h34M25 33h23" /><path className="signal-stroke" d="M53 33h7" />
    </> : <>
      <rect x="10" y="20" width="76" height="32" rx="16" strokeDasharray="2 3" />
      <path d="M25 30h13M25 36h9M59 36h12M59 42h8" />
      <path className="signal-stroke" d="M48 17v38" strokeWidth="4" />
      <circle cx="48" cy="36" r="7" fill="var(--accent)" stroke="var(--ink)" />
    </>}
  </svg>;
}

export function HowItWorks() {
  return <section className="story" aria-labelledby="how-title">
    <div className="section-intro"><h2 id="how-title">How it works</h2><p>Keep the things worth remembering. Take them to your next conversation.</p></div>
    <ol className="steps">
      <li><StepDrawing step={1} /><div><h3>1. Open</h3><p>One wallet signature opens your vault. Your key is derived here, in your browser.</p></div></li>
      <li><StepDrawing step={2} /><div><h3>2. Chat</h3><p>Use any model. Your open notes become context, and you choose what to remember next.</p></div></li>
      <li><StepDrawing step={3} /><div><h3>3. Seal</h3><p>Notes turn into ciphertext on Ethereum. Each note burns 2,000 MNEMO at the launch stamp.</p></div></li>
    </ol>
    <p className="hint">The current stamp is shown before you seal. Ethereum gas is separate.</p>
  </section>;
}

const SAMPLE_TEXT = "I think best on a long walk. Keep answers short, and save the good ideas.";
export function SampleNote() {
  const [sample] = useState(() => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return { key, ciphertext: sealNote(key, SAMPLE_TEXT) };
  });
  const [plain, setPlain] = useState<string | null>(null);
  const [error, setError] = useState("");
  return <section className="story sample-section" aria-labelledby="sample-title">
    <div className="section-intro">
      <h2 id="sample-title">See a sealed note</h2>
      <p>To Ethereum, it’s just encrypted bytes. To you, it’s a thought worth keeping.</p>
    </div>
    <div className="sample-note">
      <div className="sample-meta"><span>Example</span><span>{plain ? "Plain words" : "Ciphertext"}</span></div>
      <div className={`sample-content ${plain ? "is-open" : "is-cipher"}`}>
        {plain ? <p><Unscramble text={plain} from={sample.ciphertext.slice(2)} /></p> : <p className="num cipher">{sample.ciphertext}</p>}
      </div>
      <div className="sample-bottom">
        <p className="hint">Runs locally. No wallet or transaction.</p>
        <button className="btn" disabled={!!plain} onClick={() => {
          const text = openNote(sample.key, sample.ciphertext);
          if (text === null) setError("The sample could not open. Reload to try again.");
          else setPlain(text);
        }}>{plain ? "Sample unsealed" : "Unseal sample"}</button>
      </div>
      <p className="sr-only" role="status">{plain ? "Sample unsealed. The note is now readable." : ""}</p>
      {error && <p className="note-err" role="alert">{error}</p>}
    </div>
  </section>;
}

export function AnyModel() {
  return <section className="story" aria-labelledby="models-title">
    <div className="section-intro"><h2 id="models-title">Any model. The same memory.</h2><p>Change the model without starting over. Requests go straight from your browser to the provider you choose.</p></div>
    <ul className="model-list">
      <li><h3>Anthropic</h3><p>Bring your Claude API key and choose a model.</p></li>
      <li><h3>OpenAI</h3><p>Use your OpenAI key and a chat model.</p></li>
      <li><h3>OpenAI-compatible</h3><p>Connect any endpoint that supports the OpenAI chat format.</p></li>
      <li><h3>On your computer</h3><p>Connect a local model server with an OpenAI-compatible API and browser access enabled.</p></li>
    </ul>
    <div className="section-bottom"><p className="hint">No key yet? <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq</a> and <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> offer free API keys with usage limits. Use their OpenAI-compatible endpoint.</p><a className="text-link" href="#/chat">Choose your model <span aria-hidden="true">↗</span></a></div>
  </section>;
}

export function ChainBoundary() {
  return <section className="story" aria-labelledby="chain-title">
    <div className="section-intro"><h2 id="chain-title">On chain and off chain</h2><p>Ethereum keeps the sealed record. Your browser holds the key.</p></div>
    <table className="storage-table">
      <caption className="sr-only">What MNEMO sends to Ethereum</caption>
      <thead><tr><th scope="col">On chain</th><th scope="col">Never on chain</th></tr></thead>
      <tbody><tr>
        <td><ul><li>Ciphertext</li><li>Note ids</li><li>Key epochs</li><li>Agent grants</li><li>MNEMO burns</li></ul></td>
        <td><ul><li>Your words</li><li>Your keys</li><li>Your prompts</li></ul></td>
      </tr></tbody>
    </table>
    <p className="hint">Your chosen model receives the notes and prompts you send it. Ciphertext and transaction metadata are public on Ethereum.</p>
  </section>;
}

export function ForAgents() {
  return <section className="story" aria-labelledby="agents-story-title">
    <div className="section-intro"><h2 id="agents-story-title">For agents, too</h2><p>Grant an agent wallet access to your current key epoch. It can read those notes and seal new ones, paying its own stamp.</p></div>
    <div className="section-bottom"><a className="btn" href="#/agents">Grant an agent wallet</a><a className="text-link" href="./llms.txt">Read llms.txt <span aria-hidden="true">↗</span></a></div>
    <p className="hint">Revoke access whenever you need to. Revoking rotates the key for future notes; an agent keeps what it has already read.</p>
    <div className="script-head"><p>40 lines to read and write a vault</p><CopyButton text={script} label="Copy script" /></div>
    <pre className="code story-code" tabIndex={0} aria-label="40-line MNEMO agent script"><code>{script}</code></pre>
    <p className="hint">Node 22 with viem and noble. <a href="./mnemo-agent.mjs" download>Download mnemo-agent.mjs</a> for the full setup and usage.</p>
  </section>;
}

export function Footer() {
  const { d } = useApp();
  return <footer className="foot">
    <div className="footer-wordmark" aria-label="MNEMO">MNEMO</div>
    <div className="footer-grid">
      <div className="stack"><nav aria-label="Footer"><a href="#/">Vault</a><a href="#/chat">Chat</a><a href="#/agents">Agents</a><a href="#/trade">Trade</a><a href="./llms.txt">llms.txt</a></nav><p>No backend, no analytics.</p><p>Sealed on Ethereum.</p></div>
      <dl className="contract-list">{d.file.contracts.map((c) => <div key={c.address}>
        <dt>{c.name === "LaunchToken" ? "MNEMO token" : "MNEMO vault"}</dt>
        <dd><a className="num" href={explorerAddress(d, c.address)} target="_blank" rel="noreferrer">{c.address}</a><CopyButton text={c.address} label="Copy" name={`Copy ${c.name} address`} /></dd>
      </div>)}</dl>
    </div>
  </footer>;
}
