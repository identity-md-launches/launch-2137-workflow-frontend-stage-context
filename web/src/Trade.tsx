import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useApp, useTx, useWallet } from "./context";
import { fmt } from "./vault";
import { TxStatus } from "./ui";
import { ERC20_ABI, PERMIT2_ABI, QUOTER_ABI, ROUTER_ABI, applySlippage, encodeSwap } from "./swap";
import { explorerAddress } from "./config";
import { short } from "./ConnectSheet";

export function Trade() {
  const { d, client, tick } = useApp();
  const { address, chainOk } = useWallet();
  const tx = useTx();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState("1");
  const [quoted, setQuote] = useState<{ out: bigint; for: string } | null>(null);
  const quoteRequest = useRef(0);
  const [quoteErr, setQuoteErr] = useState("");
  const [bal, setBal] = useState<{ mnemo: bigint; pair: bigint } | null>(null);

  const pair = d.pairToken;
  const key = d.poolKey;
  const uni = d.network?.uniswapV4;
  const ready = d.swapsEnabled && pair && key && uni;

  useEffect(() => {
    if (!address || !pair) return setBal(null);
    Promise.all([
      client.readContract({ address: d.token.address, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      client.readContract({ address: pair.address, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    ])
      .then(([mnemo, p]) => setBal({ mnemo, pair: p }))
      .catch(() => setBal(null));
  }, [address, client, d, pair, tick]);

  const inToken: Address | undefined = pair ? (side === "buy" ? pair.address : d.token.address) : undefined;
  const inSym = side === "buy" ? pair?.symbol : "MNEMO";
  const outSym = side === "buy" ? "MNEMO" : pair?.symbol;
  const zeroForOne = !!key && !!inToken && key.currency0.toLowerCase() === inToken.toLowerCase();
  let amountIn = 0n;
  try {
    amountIn = amount ? parseUnits(amount, 18) : 0n;
  } catch {
    amountIn = 0n;
  }

  useEffect(() => {
    const request = ++quoteRequest.current;
    let live = true;
    setQuote(null);
    setQuoteErr("");
    if (!ready || amountIn <= 0n) return;
    const id = setTimeout(async () => {
      try {
        const { result } = await client.simulateContract({
          address: uni!.quoter,
          abi: QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: key!, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
        });
        if (live && request === quoteRequest.current) setQuote({ out: result[0], for: `${side}:${amountIn}` });
      } catch {
        if (live && request === quoteRequest.current) setQuoteErr("No quote: the pool could not price this amount. Try a smaller one.");
      }
    }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [ready, amountIn, side, client, key, uni, zeroForOne]);

  // Guard the render before the effect runs too: a quote only applies to its exact input.
  const quote = quoted?.for === `${side}:${amountIn}` ? quoted : null;

  if (!ready) {
    return (
      <section className="panel">
        <h1 className="h-page">Trade MNEMO</h1>
        <p className="hint">Trading is off: this deployment has no vetted network block or pool key, so no router address can be trusted.</p>
      </section>
    );
  }

  const bps = Math.round(Number(slip) * 100);
  const minOut = quote && Number.isFinite(bps) && bps >= 0 && bps <= 5000 ? applySlippage(quote.out, bps) : null;
  const have = bal ? (side === "buy" ? bal.pair : bal.mnemo) : null;
  const rate = quote && amountIn > 0n ? Number(formatUnits(quote.out, 18)) / Number(formatUnits(amountIn, 18)) : null;

  const swap = async () => {
    if (!address || !inToken || !minOut || amountIn <= 0n) return;
    if (have !== null && have < amountIn) return tx.fail(`This wallet holds ${fmt(have)} ${inSym}.`);
    const tokenAllowance = await client.readContract({ address: inToken, abi: ERC20_ABI, functionName: "allowance", args: [address, uni!.permit2] });
    if (tokenAllowance < amountIn) {
      if (!(await tx.send(`Step 1 of 3: allow Permit2 to move ${inSym}`, { address: inToken, abi: ERC20_ABI, functionName: "approve", args: [uni!.permit2, amountIn] }))) return;
    }
    const [p2amount, p2exp] = await client.readContract({ address: uni!.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [address, inToken, uni!.universalRouter] });
    const now = Math.floor(Date.now() / 1000);
    if (p2amount < amountIn || p2exp <= now + 60) {
      if (
        !(await tx.send(`Step 2 of 3: allow the Uniswap router through Permit2`, {
          address: uni!.permit2,
          abi: PERMIT2_ABI,
          functionName: "approve",
          args: [inToken, uni!.universalRouter, amountIn, now + 30 * 24 * 3600],
        }))
      )
        return;
    }
    const { commands, inputs } = encodeSwap({ poolKey: key!, zeroForOne, amountIn, amountOutMinimum: minOut, extended: uni!.extendedSwapParams === true });
    if (await tx.send(`Step 3 of 3: swap ${inSym} for ${outSym}`, { address: uni!.universalRouter, abi: ROUTER_ABI, functionName: "execute", args: [commands, inputs, BigInt(now + 20 * 60)] })) setAmount("");
  };

  return (
    <section className="panel trade" aria-labelledby="trade-title">
      <h1 id="trade-title" className="h-page">
        Trade MNEMO
      </h1>
      <p className="hint">
        The launch pool pairs MNEMO with {pair.symbol} on Uniswap v4. Buying spends {pair.symbol}, not ETH.
      </p>
      <div className="seg" role="group" aria-label="Direction">
        <button className={`btn ${side === "buy" ? "on" : ""}`} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
          Buy MNEMO
        </button>
        <button className={`btn ${side === "sell" ? "on" : ""}`} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
          Sell MNEMO
        </button>
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          swap().catch((err) => tx.fail(String(err)));
        }}
      >
        <label htmlFor="amt">You pay, in {inSym}</label>
        <div className="inline">
          <input id="amt" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          {have !== null && (
            <button type="button" className="btn btn-sm" onClick={() => setAmount(formatUnits(have, 18))}>
              Max
            </button>
          )}
        </div>
        <p className="hint num">Balance: {have === null ? (address ? "…" : "connect to see it") : `${fmt(have, 18, 4)} ${inSym}`}</p>
        <label htmlFor="slip">Slippage tolerance, %</label>
        <input id="slip" inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} />
        <dl className="facts">
          <div>
            <dt>You receive about</dt>
            <dd className="num">{quote ? `${fmt(quote.out, 18, 4)} ${outSym}` : amountIn > 0n && !quoteErr ? "quoting…" : "–"}</dd>
          </div>
          <div>
            <dt>Minimum after slippage</dt>
            <dd className="num">{minOut !== null ? `${fmt(minOut, 18, 4)} ${outSym}` : "–"}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd className="num">{rate !== null ? `1 ${inSym} ≈ ${rate.toPrecision(6)} ${outSym}` : "–"}</dd>
          </div>
        </dl>
        {quoteErr && <p className="note-err">{quoteErr}</p>}
        <p className="hint">USD prices are not shown: the site has no on-chain price source for them. Pool fee {(key.fee / 10000).toFixed(2)}%.</p>
        <button className="btn btn-primary btn-lg" type="submit" disabled={!chainOk || !minOut || amountIn <= 0n || tx.state.kind === "wallet" || tx.state.kind === "pending"}>
          {!address ? "Connect to trade" : !chainOk ? `Switch to ${d.chain.name} to trade` : side === "buy" ? "Buy MNEMO" : "Sell MNEMO"}
        </button>
        <p className="hint">Up to three wallet steps: approve Permit2, approve the router in Permit2, then swap. Steps already done are skipped.</p>
      </form>
      <TxStatus state={tx.state} />
      <p className="hint">
        Contracts:{" "}
        <a href={explorerAddress(d, d.token.address)} target="_blank" rel="noreferrer">
          MNEMO <span className="num">{short(d.token.address)}</span>
        </a>{" "}
        ·{" "}
        <a href={explorerAddress(d, uni.universalRouter)} target="_blank" rel="noreferrer">
          Universal Router <span className="num">{short(uni.universalRouter)}</span>
        </a>
      </p>
    </section>
  );
}
