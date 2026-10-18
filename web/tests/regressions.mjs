// Production-export regressions for navigation, credential isolation, quote races and seal locks.
// Uses only a mock wallet/model/RPC. Never broadcasts transactions or calls a paid model.
// Run after npm run build. Set IMD_PLAYWRIGHT when Playwright is installed outside web/.
// MNEMO_BROWSER=webkit selects WebKit; the default is Chromium.
// Interaction test of the built export (dist/) with a mocked EIP-6963 wallet and mocked JSON-RPC.
// Nothing is broadcast: the public RPC URLs are intercepted and answered here, and the wallet's
// signatures come from a throwaway test key. One foreground command: it serves dist/, runs the
// flows, prints a report and exits non-zero on the first failure.
//   IMD_PLAYWRIGHT=<path to playwright/index.mjs> node tests/e2e.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeFunctionResult, parseAbi, keccak256, toHex, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const engines = await import(process.env.IMD_PLAYWRIGHT ?? "playwright");
const engineName = process.env.MNEMO_BROWSER ?? "chromium";
const engine = engines[engineName];
if (!engine) throw new Error(`Unknown browser ${engineName}`);
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

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const waitUntil = async (fn) => {
  const deadline = Date.now() + 10000;
  while (!fn()) { if (Date.now() > deadline) throw new Error("Timed out waiting for the mock request"); await new Promise((r) => setTimeout(r, 20)); }
};
const quotePlans = new Map();
const receiptGates = new Map();
const failedHashes = new Set();
let holdReceipts = false, failNextWrite = false;
let modelGate = null;
let modelReply = "Noted, tea it is.\n<remember>\nPrefers green tea\n</remember>";
const modelRequests = [];
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
  if (m === "eth_getTransactionReceipt") return ok({ status: failedHashes.has(req.params[0]) ? "0x0" : "0x1", transactionHash: req.params[0], blockNumber: "0x1900a01", blockHash: `0x${"cd".repeat(32)}`, logs: [], gasUsed: "0x1", cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1", from: acct.address, to: VAULT, contractAddress: null, transactionIndex: "0x0", logsBloom: `0x${"0".repeat(512)}`, type: "0x2" });
  if (m === "eth_getTransactionByHash") return ok({ hash: req.params[0], blockNumber: "0x1900a01", from: acct.address, to: VAULT, input: "0x", value: "0x0", nonce: "0x0", gas: "0x1", type: "0x2", chainId: "0x1" });
  if (m === "eth_call") {
    const { to, data } = req.params[0];
    const abi = abiAt[to.toLowerCase()];
    if (!abi || !data || data === "0x") return ok("0x");
    const { functionName, args } = decodeFunctionData({ abi, data });
    if (functionName === "quoteExactInputSingle") {
      const plan = quotePlans.get(`${args[0].zeroForOne}:${args[0].exactAmount}`);
      if (plan?.error) return { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted: stale quote" } };
      if (plan) return ok(encodeFunctionResult({ abi, functionName, result: [plan.out, 100000n] }));
    }
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
  console.log(report.at(-1));
  if (!cond) failed = true;
};

const browser = await engine.launch();
const shots = join(dirname(fileURLToPath(import.meta.url)), "../../test/scratch/interactions", engineName);
mkdirSync(shots, { recursive: true });
const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await browserContext.newPage();
page.setDefaultTimeout(10000);
const watchdog = setTimeout(() => { console.error("Regression test exceeded 120 seconds"); process.exit(1); }, 120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_|CORS/.test(m.text()) && errors.push(m.text()));

for (const url of dep.network.rpcUrls) {
  await page.route(`${url}**`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const respond = async (req) => {
      if (req.method === "eth_getTransactionReceipt" && holdReceipts) {
        const gate = deferred(); receiptGates.set(req.params[0], gate); await gate.promise; receiptGates.delete(req.params[0]);
      }
      if (req.method === "eth_call" && req.params[0].to.toLowerCase() === U.quoter) {
        const { args } = decodeFunctionData({ abi: quoter, data: req.params[0].data });
        const plan = quotePlans.get(`${args[0].zeroForOne}:${args[0].exactAmount}`);
        if (plan) { plan.started.resolve(); await plan.release.promise; }
      }
      return rpc(req);
    };
    const out = Array.isArray(body) ? await Promise.all(body.map(respond)) : await respond(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
}
for (const url of ["https://api.anthropic.com/**", "https://api.openai.com/**", "https://model-a.test/**", "https://model-b.test/**"]) {
  await page.route(url, async (route) => {
    const request = route.request();
    modelRequests.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    const reply = modelReply;
    if (modelGate) { modelGate.started.resolve(); await modelGate.release.promise; }
    const body = request.url().includes("anthropic.com") ? { content: [{ type: "text", text: reply }] } : { choices: [{ message: { content: reply } }] };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}

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
    const hash = keccak256(toHex(`tx${sent.length}`));
    if (failNextWrite && params[0].to.toLowerCase() === VAULT) { failedHashes.add(hash); failNextWrite = false; }
    return { result: hash };
  }
  const r = rpc({ id: 1, method, params });
  return r.error ? { error: r.error } : { result: r.result };
});
await page.addInitScript((address) => {
  let chainId = "0x1"; // starts on the wrong chain
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
  // Exercise copy controls deterministically without depending on OS clipboard permission.
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } });
}, acct.address);

const nav = async (name) => {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();
  await page.waitForFunction((name) => document.querySelector('nav[aria-label="Sections"] [aria-current="page"]')?.textContent === name, name);
};
const pending = async (count) => { await waitUntil(() => sent.length === count && receiptGates.size > 0); };
const releaseReceipts = () => { for (const gate of receiptGates.values()) gate.resolve(); };
const planQuote = (amount, out, side = false, error = false) => {
  const plan = { out: BigInt(out) * E18, error, started: deferred(), release: deferred() };
  quotePlans.set(`${side}:${BigInt(amount) * E18}`, plan); return plan;
};
const minimum = () => page.getByText("Minimum after slippage", { exact: true }).locator("..").locator("dd");
const screenshot = (name, fullPage = false) => page.screenshot({ path: join(shots, `${name}.webp`), type: "webp", quality: 76, fullPage, animations: "disabled" });
const frame = async () => { await page.waitForTimeout(100); };
const audit = async (name) => {
  if (!process.env.MNEMO_AXE) return;
  const { default: AxeBuilder } = await import(process.env.MNEMO_AXE);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  writeFileSync(join(shots, `axe-${name}.json`), JSON.stringify(result, null, 2));
  check(`automated accessibility audit on ${name}`, result.violations.length === 0, result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join(" | "));
};

try {
  await page.goto(base, { waitUntil: "networkidle" });
  check("home story has the requested section order", JSON.stringify(await page.locator("main > section h2").allTextContents()) === JSON.stringify([
    "How it works", "See a sealed note", "Any model. The same memory.", "On chain and off chain", "For agents, too", "Network totals", "Questions"
  ]));
  const action = await page.getByRole("button", { name: "Open your vault" }).boundingBox();
  check("product and main action fit the first 390px screen", !!action && action.y + action.height < 844);
  await screenshot("home-390");
  await page.getByRole("button", { name: "Unseal sample" }).click();
  await page.waitForFunction(() => document.querySelector(".sample-content").innerText.includes("save the good ideas."));
  check("sample decrypts locally into real words", (await page.locator(".sample-content").innerText()).includes("I think best on a long walk."));
  check("sample requires no wallet or transaction", walletLog.length === 0 && sent.length === 0);
  await audit("unsealed-sample");
  await page.getByRole("button", { name: "Copy script", exact: true }).click();
  const script = readFileSync(join(dist, "mnemo-agent.mjs"), "utf8");
  check("copy button copies the exact 40-line downloadable agent script", (await page.evaluate(() => window.__copied)) === script && script.trimEnd().split("\n").length === 40);
  await page.getByRole("button", { name: "Copy LaunchToken address" }).click();
  check("footer copies the verified contract address", (await page.evaluate(() => window.__copied)) === at("LaunchToken"));
  await page.getByText("What happens when I change models?", { exact: true }).click();
  check("questions expand with useful answers", await page.getByText(/Your conversation, draft and proposed notes stay in this tab/).isVisible());
  await screenshot("home-390-full", true);

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const connectDialog = page.getByRole("dialog");
  const dialogButtons = connectDialog.getByRole("button");
  await dialogButtons.last().focus(); await page.keyboard.press("Tab");
  check("wallet dialog traps forward keyboard focus", await page.getByRole("button", { name: "Close", exact: true }).evaluate((b) => b === document.activeElement));
  await page.keyboard.press("Shift+Tab");
  check("wallet dialog traps backward keyboard focus", await dialogButtons.last().evaluate((b) => b === document.activeElement));
  await page.keyboard.press("Escape");
  check("wallet dialog restores focus to the connect trigger", await page.getByRole("button", { name: "Connect", exact: true }).evaluate((b) => b === document.activeElement));
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await connectDialog.getByRole("button", { name: "Test Wallet" }).click();
  await page.getByRole("button", { name: /0xf39F/ }).waitFor();
  await nav("Chat");
  await page.getByLabel("API key", { exact: true }).fill("anthropic-test-key");
  await page.getByLabel("Message", { exact: true }).fill("I like green tea");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("Noted, tea it is.", { exact: true }).waitFor();
  await page.getByLabel("Proposal 1", { exact: true }).fill("Prefers green tea, no sugar");
  await page.getByLabel("Keep proposal 1", { exact: true }).uncheck();
  await page.getByLabel("Message", { exact: true }).fill("A draft for later");
  for (const name of ["Vault", "Agents", "Trade", "Chat"]) await nav(name);
  check("bug 1: conversation survives route navigation", await page.getByText("Noted, tea it is.", { exact: true }).isVisible());
  check("bug 1: unsent draft survives navigation", (await page.getByLabel("Message", { exact: true }).inputValue()) === "A draft for later");
  check("bug 1: edited proposal and its selection survive navigation", (await page.getByLabel("Proposal 1", { exact: true }).inputValue()) === "Prefers green tea, no sugar" && !(await page.getByLabel("Keep proposal 1").isChecked()));
  check("bug 1: unremembered API key survives navigation in memory", (await page.getByLabel("API key", { exact: true }).inputValue()) === "anthropic-test-key" && await page.evaluate(() => localStorage.getItem("mnemo.chat.keys.v2") === null));
  const chatHash = await page.evaluate(() => location.hash);
  await page.getByRole("complementary").getByRole("button", { name: "Open your vault", exact: true }).click();
  await page.getByRole("complementary").getByText("Nothing yet.", { exact: false }).waitFor();
  check("bug 1: vault opens in chat with exactly one signature", walletLog.filter((w) => w.method === "personal_sign").length === 1 && await page.evaluate(() => location.hash) === chatHash);
  check("bug 1: opening the vault preserves the draft and proposals", (await page.getByLabel("Message", { exact: true }).inputValue()) === "A draft for later" && (await page.getByLabel("Proposal 1", { exact: true }).inputValue()) === "Prefers green tea, no sugar");

  await nav("Vault");
  await page.getByLabel("New note").fill("Only seal this once");
  holdReceipts = true;
  const before = sent.length;
  // requestSubmit bypasses disabled submit buttons, so this tests the provider's same-tick guard.
  await page.getByLabel("New note").evaluate((field) => { for (let i = 0; i < 3; i++) field.form.requestSubmit(); });
  await pending(before + 1);
  check("bug 4: one approval after repeated same-tick submissions", sent.length === before + 1);
  check("bug 4: Seal is disabled during the approval receipt", await page.getByRole("button", { name: "Sealing note…", exact: true }).isDisabled());
  await page.getByLabel("New note").evaluate((field) => field.form.requestSubmit());
  releaseReceipts();
  await pending(before + 2);
  check("bug 4: Seal stays disabled through the write receipt", await page.getByRole("button", { name: "Sealing note…", exact: true }).isDisabled());
  await screenshot("vault-pending-390");
  holdReceipts = false; releaseReceipts();
  await page.getByText("Seal 1 note: confirmed").waitFor();
  check("bug 4: only one write is sent for the click", sent.length === before + 2 && decodeFunctionData({ abi: vaultAbi, data: sent.at(-1).data }).functionName === "write");

  await nav("Trade");
  const old = planQuote(111, 1111), current = planQuote(222, 2222);
  await page.getByLabel(/You pay/).fill("111"); await old.started.promise;
  await page.getByLabel(/You pay/).fill("222"); await current.started.promise;
  check("bug 3: changing input immediately clears the previous minimum", (await minimum().innerText()) === "–");
  current.release.resolve();
  await page.waitForFunction(() => document.body.innerText.includes("2,199.78"));
  old.release.resolve(); await frame();
  check("bug 3: a late old success cannot overwrite the current minimum", (await minimum().innerText()).includes("2,199.78"));
  const staleError = planQuote(333, 3333, false, true), latest = planQuote(444, 4444);
  await page.getByLabel(/You pay/).fill("333"); await staleError.started.promise;
  await page.getByLabel(/You pay/).fill("444"); await latest.started.promise;
  latest.release.resolve(); await page.waitForFunction(() => document.body.innerText.includes("4,399.56"));
  staleError.release.resolve(); await page.waitForTimeout(500);
  check("bug 3: a stale failed request cannot replace current quote state", (await minimum().innerText()).includes("4,399.56") && !(await page.getByText(/No quote: the pool/).isVisible()));
  const buy = planQuote(555, 5555), sell = planQuote(555, 7777, true);
  await page.getByLabel(/You pay/).fill("555"); await buy.started.promise;
  await page.getByRole("button", { name: "Sell MNEMO", exact: true }).first().click(); await sell.started.promise;
  sell.release.resolve(); await page.waitForFunction(() => document.body.innerText.includes("7,699.23"));
  buy.release.resolve(); await frame();
  check("bug 3: changing buy/sell rejects the previous direction's response", (await minimum().innerText()).includes("7,699.23 IMD"));
  await page.getByLabel(/You pay/).fill("");
  check("bug 3: clearing the amount immediately removes the minimum", (await minimum().innerText()) === "–");

  await nav("Chat");
  await page.getByLabel("Keep proposal 1").check();
  holdReceipts = true; failNextWrite = true;
  const chatBefore = sent.length;
  await page.getByRole("button", { name: "Seal 1 note", exact: true }).click();
  await pending(chatBefore + 1);
  check("bug 4: chat Seal disables during approval", await page.getByRole("button", { name: "Sealing notes…", exact: true }).isDisabled());
  await nav("Vault");
  await page.getByLabel("New note").fill("Do not send while chat is sealing");
  check("bug 4: the seal lock survives navigation and disables the other Seal", await page.getByRole("button", { name: "Sealing note…", exact: true }).isDisabled());
  await page.getByLabel("New note").evaluate((field) => field.form.requestSubmit());
  await nav("Chat");
  releaseReceipts(); await pending(chatBefore + 2);
  check("bug 4: chat Seal remains disabled until the write receipt", await page.getByRole("button", { name: "Sealing notes…", exact: true }).isDisabled());
  await screenshot("chat-pending-390");
  holdReceipts = false; releaseReceipts();
  await page.locator(".tx-error").waitFor();
  check("bug 4: failed receipt is reported as a transaction failure", /revert|refused|failed/i.test(await page.locator(".tx-error").innerText()), await page.locator(".tx-error").innerText());
  check("bug 4: a failed receipt re-enables Seal and preserves proposals", await page.getByRole("button", { name: "Seal 1 note", exact: true }).isEnabled() && await page.getByLabel("Proposal 1", { exact: true }).isVisible());
  check("bug 4: navigating and submitting while pending sends no duplicate", sent.length === chatBefore + 2);
  await page.getByRole("button", { name: "Seal 1 note", exact: true }).click();
  await page.getByText("Seal 1 note: confirmed").waitFor();
  check("bug 4: retry confirms and only then clears proposals", await page.getByLabel("Proposal 1", { exact: true }).count() === 0 && sent.length === chatBefore + 4);

  modelGate = { started: deferred(), release: deferred() };
  modelReply = "A reply that arrived while you were away.\n<remember>\nKeeps long walks for thinking\n</remember>";
  await page.getByLabel("Message", { exact: true }).fill("Remember that I walk to think");
  await page.getByRole("button", { name: "Send", exact: true }).click(); await modelGate.started.promise;
  await nav("Agents"); modelGate.release.resolve();
  await nav("Chat");
  await page.getByText("A reply that arrived while you were away.", { exact: true }).waitFor(); modelGate = null;
  check("bug 1: replies and proposals received away from chat are retained", (await page.getByLabel("Proposal 1", { exact: true }).inputValue()) === "Keeps long walks for thinking");

  await page.getByLabel("Remember on this device").check();
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("mnemo.chat.keys.v2"))?.["https://api.anthropic.com"]?.anthropic);
  await page.getByLabel("Provider", { exact: true }).selectOption("openai");
  check("bug 2: changing provider clears the active key", await page.getByLabel("API key", { exact: true }).inputValue() === "");
  const requestsBeforeValidation = modelRequests.length;
  await page.getByLabel("Message", { exact: true }).fill("Check missing provider key");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  check("bug 2: a required missing key prevents a request to another provider", modelRequests.length === requestsBeforeValidation && await page.getByText("Enter your OpenAI API key.", { exact: true }).isVisible());
  await page.getByLabel("API key", { exact: true }).fill("openai-test-key");
  modelReply = "A reply from OpenAI.";
  await page.getByRole("button", { name: "Send", exact: true }).click(); await page.getByText(modelReply, { exact: true }).waitFor();
  check("bug 2: the new provider receives only its own key", modelRequests.at(-1).headers.authorization === "Bearer openai-test-key" && !modelRequests.at(-1).headers["x-api-key"]);
  await page.getByLabel("Provider", { exact: true }).selectOption("compatible");
  await page.getByLabel(/Endpoint base URL/).fill("https://model-a.test/v1");
  await page.getByLabel("Model", { exact: true }).fill("test-model");
  await page.getByLabel(/API key/).fill("origin-a-test-key");
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("mnemo.chat.keys.v2"))?.["https://model-a.test"]?.compatible);
  await page.getByLabel(/Endpoint base URL/).fill("https://model-b.test/v1");
  check("bug 2: changing endpoint origin clears the key", await page.getByLabel(/API key/).inputValue() === "");
  modelReply = "A keyless response from origin B.";
  await page.getByLabel("Message", { exact: true }).fill("Do not send origin A's key");
  await page.getByRole("button", { name: "Send", exact: true }).click(); await page.getByText(modelReply, { exact: true }).waitFor();
  check("bug 2: the old origin's key never reaches the new origin", modelRequests.at(-1).url.startsWith("https://model-b.test/") && !modelRequests.at(-1).headers.authorization && !modelRequests.at(-1).headers["x-api-key"]);
  await page.getByLabel(/API key/).fill("origin-b-test-key");
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("mnemo.chat.keys.v2"))?.["https://model-b.test"]?.compatible);
  const keys = await page.evaluate(() => JSON.parse(localStorage.getItem("mnemo.chat.keys.v2")));
  check("bug 2: remembered keys are stored separately per provider and origin", keys["https://api.anthropic.com"].anthropic === "anthropic-test-key" && keys["https://api.openai.com"].openai === "openai-test-key" && keys["https://model-a.test"].compatible === "origin-a-test-key" && keys["https://model-b.test"].compatible === "origin-b-test-key");
  await page.getByLabel(/Endpoint base URL/).fill("https://model-a.test/v1");
  check("bug 2: returning to a saved origin still clears the active key", await page.getByLabel(/API key/).inputValue() === "");
  await page.getByRole("button", { name: "Use saved key for this origin" }).click();
  check("bug 2: explicit restore loads only the matching origin's key", await page.getByLabel(/API key/).inputValue() === "origin-a-test-key");
  await page.getByLabel(/Endpoint base URL/).fill("https://model-a.test/v2");
  check("bug 2: changing a path on the same origin also clears the active key", await page.getByLabel(/API key/).inputValue() === "");
  await page.getByLabel("Provider", { exact: true }).selectOption("local");
  await page.getByLabel(/Your model server's address/).fill("https://model-a.test/v1");
  check("bug 2: two provider modes on one origin do not inherit each other's key", await page.getByLabel(/API key/).inputValue() === "" && await page.getByRole("button", { name: "Use saved key for this origin" }).count() === 0);
  await page.getByLabel("Provider", { exact: true }).selectOption("openai");
  await page.getByRole("button", { name: "Use saved key for this origin" }).click();
  await page.reload({ waitUntil: "networkidle" });
  check("bug 2: reload restores only the remembered provider's own key", await page.getByLabel("API key", { exact: true }).inputValue() === "openai-test-key");
  check("conversation and proposals are tab-memory only, never persisted to storage", await page.getByLabel("Proposal 1", { exact: true }).count() === 0 && (await page.locator(".convo").innerText()).includes("Ask anything."));
  await page.getByLabel("Remember on this device").uncheck();
  check("bug 2: opting out removes every saved provider key", await page.evaluate(() => localStorage.getItem("mnemo.chat.keys.v2") === null && localStorage.getItem("mnemo.chat.v2") === null && localStorage.getItem("mnemo.chat.v1") === null));

  for (const name of ["Vault", "Chat", "Agents", "Trade"]) {
    await nav(name);
    const hash = await page.evaluate(() => location.hash);
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); document.querySelector(".skip").focus(); });
    await page.keyboard.press("Enter");
    check(`bug 5: skip link focuses main on ${name} without changing the hash`, await page.evaluate((h) => location.hash === h && document.activeElement.id === "main" && Math.abs(document.querySelector("main").getBoundingClientRect().top) < 2, hash));
  }
  for (const width of [320, 390, 500, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const name of ["Vault", "Chat", "Agents", "Trade"]) {
      await nav(name); await frame();
      check(`no horizontal scroll at ${width}px on ${name}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390) await audit(name.toLowerCase());
      if (name === "Vault") await screenshot(`home-${width}-full`, true);
      if (name === "Chat" && width === 390) await screenshot("chat-390-full", true);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await nav("Vault");
  const canvasBefore = await page.locator("canvas").evaluate((c) => c.toDataURL());
  await page.waitForTimeout(150);
  check("reduced motion renders a static capsule", canvasBefore === await page.locator("canvas").evaluate((c) => c.toDataURL()));
  await page.getByRole("button", { name: "Unseal sample" }).click();
  check("reduced motion shows sample words without animation", (await page.locator(".sample-content").innerText()).includes("save the good ideas."));
  check("no script errors in the production export", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("Current transaction status:", await page.locator(".tx").allTextContents());
  console.log("Sent transactions:", sent.map((s) => ({ to: s.to, selector: s.data.slice(0, 10) })));
  check("regression flow completed", false, e.stack);
  await screenshot("failure", true).catch(() => {});
} finally {
  holdReceipts = false; releaseReceipts();
  for (const plan of quotePlans.values()) plan.release.resolve();
  modelGate?.release.resolve();
  clearTimeout(watchdog);
  await browser.close(); server.close();
}
const output = report.join("\n") + `\n${report.filter((r) => r.startsWith("PASS")).length}/${report.length} passed (${engineName})\n`;
writeFileSync(join(shots, "results.txt"), output);
console.log(output);
process.exit(failed ? 1 : 0);
