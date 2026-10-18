// Interaction test of the built export (dist/) with a mocked EIP-6963 wallet and mocked JSON-RPC.
// Nothing is broadcast: the public RPC URLs are intercepted and answered here, and the wallet's
// signatures come from a throwaway test key. One foreground command: it serves dist/, runs the
// flows, prints a report and exits non-zero on the first failure.
//   IMD_PLAYWRIGHT=<path to playwright/index.mjs> node tests/e2e.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeFunctionResult, parseAbi, keccak256, toHex, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const browsers = await import(process.env.IMD_PLAYWRIGHT ?? "playwright");
const engine = browsers[process.env.MNEMO_BROWSER ?? "chromium"];
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
const dep = JSON.parse(readFileSync(join(dist, "imd-deployment.json"), "utf8"));
const at = (n) => dep.contracts.find((c) => c.name === n).address.toLowerCase();
const VAULT = at("MnemoVault"), TOKEN = at("LaunchToken"), U = dep.network.uniswapV4, PAIR = dep.network.pairToken.address.toLowerCase();
// Hardhat's well-known test account 0: a throwaway key, never funded on mainnet by this test.
const acct = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const vaultAbi = JSON.parse(readFileSync(join(dist, "abi/MnemoVault.json"), "utf8"));
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const permit2 = parseAbi(["function allowance(address,address,address) view returns (uint160,uint48,uint48)", "function approve(address,address,uint160,uint48)"]);
const quoter = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct Q { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(Q params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const router = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const abiAt = { [VAULT]: vaultAbi, [TOKEN]: erc20, [PAIR]: erc20, [U.permit2]: permit2, [U.quoter]: quoter, [U.universalRouter]: router };
const E18 = 10n ** 18n;
const results = { notesTotal: 5n, burnedTotal: 10000n * E18, stamp: 2000n * E18, epochOf: 0, owner: "0x1111111111111111111111111111111111111111", pendingOwner: "0x0000000000000000000000000000000000000000", keyOf: `0x${"0".repeat(64)}`, isGranted: false, balanceOf: 1_000_000n * E18, allowance: 0n, quoteExactInputSingle: [2000n * E18, 100000n], approve: true, write: 6n };

const sent = [];
const rpcCalls = [];
function rpc(req) {
  const ok = (result) => ({ jsonrpc: "2.0", id: req.id, result });
  const m = req.method;
  rpcCalls.push(m);
  if (m === "eth_chainId") return ok("0x1");
  if (m === "eth_blockNumber") return ok("0x1900a00");
  if (m === "eth_getLogs") return ok([]);
  if (m === "eth_estimateGas") return ok("0x30000");
  if (m === "eth_gasPrice" || m === "eth_maxPriorityFeePerGas") return ok("0x3b9aca00");
  if (m === "eth_getBlockByNumber") return ok({ number: "0x1900a00", baseFeePerGas: "0x3b9aca00", timestamp: "0x6700000", hash: `0x${"ab".repeat(32)}`, transactions: [] });
  if (m === "eth_getTransactionReceipt") return ok({ status: "0x1", transactionHash: req.params[0], blockNumber: "0x1900a01", blockHash: `0x${"cd".repeat(32)}`, logs: [], gasUsed: "0x1", cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1", from: acct.address, to: VAULT, contractAddress: null, transactionIndex: "0x0", logsBloom: `0x${"0".repeat(512)}`, type: "0x2" });
  if (m === "eth_getTransactionByHash") return ok({ hash: req.params[0], blockNumber: "0x1900a01", from: acct.address, to: VAULT, input: "0x", value: "0x0", nonce: "0x0", gas: "0x1", type: "0x2", chainId: "0x1" });
  if (m === "eth_call") {
    const { to, data } = req.params[0];
    const abi = abiAt[to.toLowerCase()];
    if (!abi) return ok("0x");
    const { functionName } = decodeFunctionData({ abi, data });
    if (functionName === "execute") return ok("0x");
    if (functionName === "allowance" && to.toLowerCase() === U.permit2) return ok(encodeFunctionResult({ abi, functionName, result: [0n, 0, 0] }));
    return ok(encodeFunctionResult({ abi, functionName, result: results[functionName] }));
  }
  return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `unmocked ${m}` } };
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".mjs": "text/javascript" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0].replace(/^\/site/, "")) || "/";
  const file = join(dist, path.endsWith("/") ? `${path}index.html` : path);
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/site/`; // a subpath, as on a gateway

const report = [];
let failed = false;
const check = (name, cond, extra = "") => {
  report.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) failed = true;
};

const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_|CORS/.test(m.text()) && errors.push(m.text()));

for (const url of dep.network.rpcUrls) {
  await page.route(`${url}**`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const out = Array.isArray(body) ? body.map(rpc) : rpc(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
}
await page.route("https://api.anthropic.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "Noted, tea it is.\n<remember>\nPrefers green tea\n</remember>" }] }) }),
);

let rejectNextSign = false;
const walletLog = [];
await page.exposeFunction("__wallet", async (method, params) => {
  walletLog.push({ method, params });
  if (method === "personal_sign") {
    if (rejectNextSign) {
      rejectNextSign = false;
      return { error: { code: 4001, message: "User rejected the request." } };
    }
    return { result: await acct.signMessage({ message: { raw: params[0] } }) };
  }
  if (method === "eth_sendTransaction") {
    sent.push(params[0]);
    return { result: keccak256(toHex(`tx${sent.length}`)) };
  }
  const r = rpc({ id: 1, method, params });
  return r.error ? { error: r.error } : { result: r.result };
});
await page.addInitScript((address) => {
  let chainId = "0xaa36a7"; // starts on the wrong chain
  let switchFailsOnce = true;
  let authorized = false; // the site has not been connected before
  const listeners = {};
  const emit = (e, v) => (listeners[e] ?? []).forEach((f) => f(v));
  const provider = {
    on: (e, f) => ((listeners[e] ??= []).push(f), provider),
    removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((g) => g !== f)), provider),
    async request({ method, params }) {
      if (method === "eth_requestAccounts") return (authorized = true), [address];
      if (method === "eth_accounts") return authorized ? [address] : [];
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        window.__switchCalls = (window.__switchCalls ?? 0) + 1;
        if (switchFailsOnce) {
          switchFailsOnce = false;
          throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
        }
        chainId = params[0].chainId;
        emit("chainChanged", chainId);
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        window.__added = params[0];
        return null;
      }
      const r = await window.__wallet(method, params ?? []);
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
      return r.result;
    },
  };
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Crect width='28' height='28' fill='%23333'/%3E%3C/svg%3E";
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "7c1e1b8a-0000-4000-8000-000000000001", name: "Test Wallet", icon, rdns: "test.wallet" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}, acct.address);

try {
  await page.goto(base, { waitUntil: "networkidle" });
  const h1 = page.getByRole("heading", { level: 1 });
  check("home renders the tagline", (await h1.textContent()) === "Your AI's memory, sealed on chain");
  const openBtn = page.getByRole("button", { name: "Open your vault" });
  const box = await openBtn.boundingBox();
  check("main action is on the first screen at 390x844", !!box && box.y + box.height <= 844, box ? `bottom ${Math.round(box.y + box.height)}px` : "missing");
  await page.getByText("Notes sealed").waitFor();
  await page.waitForFunction(() => document.body.innerText.includes("10,000"));
  check("network totals read from the vault (notesTotal 5, burned 10,000)", (await page.locator(".facts").first().innerText()).includes("5"));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check("no horizontal scroll at 390", sw <= 390, `scrollWidth ${sw}`);

  await openBtn.click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  check("Open your vault while disconnected opens the connect sheet", await dialog.isVisible());
  check("sheet lists the EIP-6963 wallet by name", await dialog.getByRole("button", { name: "Test Wallet" }).isVisible());
  check("sheet lists Coinbase Wallet", await dialog.getByRole("button", { name: /Coinbase Wallet/ }).isVisible());
  check("generic 'Injected' row hidden", !(await dialog.innerText()).includes("Injected"));
  await page.keyboard.press("Escape");
  check("Escape closes the sheet", !(await dialog.isVisible()));
  await page.getByRole("button", { name: "Connect" }).click();
  await dialog.getByRole("button", { name: "Test Wallet" }).click();

  const switchBtn = page.getByRole("button", { name: "Switch to Ethereum" }).first();
  await switchBtn.waitFor();
  check("wrong chain shows a single Switch to Ethereum control in the header and hero", (await page.getByRole("button", { name: "Switch to Ethereum" }).count()) === 2);
  await switchBtn.click();
  await page.getByRole("button", { name: /0xf39F/ }).waitFor();
  const added = await page.evaluate(() => window.__added);
  check("unknown chain (4902) falls back to wallet_addEthereumChain with network.json's walletAddChain", JSON.stringify(added) === JSON.stringify(dep.walletAddChain));
  check("then switches again", (await page.evaluate(() => window.__switchCalls)) === 2);

  rejectNextSign = true;
  await page.getByRole("button", { name: "Open your vault" }).click();
  await page.getByText("You rejected the request in your wallet.").waitFor();
  check("a rejected signature shows a plain message and the vault stays closed", !(await page.getByRole("heading", { name: "Your vault" }).isVisible()));

  await page.getByRole("button", { name: "Open your vault" }).click();
  await page.getByRole("heading", { name: "Your vault" }).waitFor();
  check("one signature opens the vault", walletLog.filter((w) => w.method === "personal_sign").length === 2);
  await page.getByLabel("New note").fill("I take my coffee black");
  await page.getByRole("button", { name: /Seal note/ }).click();
  await page.getByText("Seal 1 note: confirmed").waitFor({ timeout: 15000 });
  check("sealing asks for the MNEMO approval first, then write", sent.length === 2 && sent[0].to.toLowerCase() === TOKEN && sent[1].to.toLowerCase() === VAULT);
  const w = decodeFunctionData({ abi: vaultAbi, data: sent[1].data });
  const sig = await acct.signMessage({ message: `MNEMO vault key v1 for ${acct.address}` });
  const key = hkdf(sha256, hexToBytes(sig), new TextEncoder().encode("MNEMO"), new TextEncoder().encode("vault:0"), 32);
  const ct = hexToBytes(w.args[0][0]);
  const plain = new TextDecoder().decode(xchacha20poly1305(key, ct.slice(1, 25)).decrypt(ct.slice(25)));
  check("write() carries ciphertext that only the owner's derived key opens, at the current epoch", w.functionName === "write" && w.args[1] === 0 && plain === "I take my coffee black");
  check("no plaintext in the transaction", !sent[1].data.includes(toHex("coffee").slice(2)));

  await page.goto(`${base}#/trade`);
  await page.getByRole("heading", { name: "Trade MNEMO" }).waitFor();
  await page.getByLabel(/You pay/).fill("100");
  await page.waitForFunction(() => document.body.innerText.includes("2,000"));
  check("quote from the network block's quoter is shown with slippage minimum", (await page.locator(".facts").innerText()).includes("1,980"));
  const before = sent.length;
  await page.getByRole("button", { name: "Buy MNEMO" }).last().click();
  await page.getByText(/Step 3 of 3: swap IMD for MNEMO: confirmed/).waitFor({ timeout: 15000 });
  const [a1, a2, ex] = sent.slice(before);
  check("buy approves IMD to Permit2, then Permit2 to the router, then executes", a1?.to.toLowerCase() === PAIR && a2?.to.toLowerCase() === U.permit2 && ex?.to.toLowerCase() === U.universalRouter);
  check("swap sends no ETH value for an IMD pair", !ex?.value || BigInt(ex.value) === 0n);
  check("execute uses V4_SWAP", decodeFunctionData({ abi: router, data: ex.data }).args[0] === "0x10");

  await page.goto(`${base}#/chat`);
  await page.getByRole("heading", { name: "What MNEMO remembers" }).waitFor();
  await page.getByLabel("API key").fill("sk-test");
  await page.getByLabel("Message").fill("I like green tea");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Noted, tea it is.").waitFor();
  check("chat reply shown and a memory proposed", await page.getByLabel("Proposal 1", { exact: true }).isVisible());
  check("key kept in memory only by default", (await page.evaluate(() => localStorage.getItem("mnemo.chat.v1"))) === null);

  await page.goto(`${base}#/agents`);
  check("agents page has register, grant, write-for and docs", (await page.getByRole("button", { name: "Register my key" }).isVisible()) && (await page.getByRole("button", { name: "Grant" }).isVisible()) && (await page.getByRole("button", { name: "Write note" }).isVisible()) && (await page.locator("pre code").innerText()).includes("writeFor"));
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const r of ["#/", "#/chat", "#/agents", "#/trade"]) {
      await page.goto(`${base}${r}`);
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`no horizontal scroll at ${width} on ${r}`, s <= width, `scrollWidth ${s}`);
    }
  }
  check("no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("flow completed", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  server.close();
}
console.log(report.join("\n"));
console.log(`${report.filter((r) => r.startsWith("PASS")).length}/${report.length} passed`);
if (failed) process.exit(1);
// Keep the original flows and run the navigation, credential, quote and seal regressions too.
await import("./regressions.mjs");
