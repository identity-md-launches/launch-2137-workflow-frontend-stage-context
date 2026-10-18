// mnemo-agent.mjs: read and write a MNEMO vault that granted this agent. Node 22 with:
//   npm i viem @noble/hashes @noble/ciphers @noble/curves
// AGENT_KEY=0x<agent wallet private key> node mnemo-agent.mjs <site url> <owner address> ["note to write"]
// Run once to register the agent, then ask the vault owner to grant its wallet.
// The grant seals the current epoch key to this agent; no vault secret is configured here.
// Writing approves exactly the current stamp. The agent pays its own MNEMO and gas.
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, hexToBytes, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 as xc } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
const [site, owner, note] = process.argv.slice(2);
const dep = await (await fetch(new URL("imd-deployment.json", site))).json();
const at = (n) => dep.contracts.find((c) => c.name === n).address, vault = at("MnemoVault");
const n = dep.network, chain = { id: dep.chainId, name: n.name, nativeCurrency: n.nativeCurrency, rpcUrls: { default: { http: n.rpcUrls } } };
const account = privateKeyToAccount(process.env.AGENT_KEY), pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() }), enc = (s) => new TextEncoder().encode(s);
const kdf = (ikm, salt, info) => hkdf(sha256, ikm, salt, enc(info), 32);
const secret = kdf(hexToBytes(await account.signMessage({ message: `MNEMO agent key v1 for ${account.address}` })), enc("MNEMO"), "agent");
const me = x25519.getPublicKey(secret), abi = parseAbi(["function epochOf(address) view returns (uint32)",
  "function keyOf(address) view returns (bytes32)", "function stamp() view returns (uint256)", "function register(bytes32)",
  "function writeFor(address owner, bytes[] notes, uint32 epoch) returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const send = async (address, functionName, args) => pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi, functionName, args }) });
if (BigInt(await pub.readContract({ address: vault, abi, functionName: "keyOf", args: [account.address] })) === 0n) {
  await send(vault, "register", [bytesToHex(me)]); console.log("Registered. Ask the owner to grant", account.address); process.exit(0); }
const epoch = await pub.readContract({ address: vault, abi, functionName: "epochOf", args: [owner] });
const logs = (event, args) => pub.getLogs({ address: vault, event: parseAbiItem(event), args, fromBlock: 26216887n });
const grant = (await logs("event Granted(address indexed owner, address indexed agent, uint32 epoch, bytes sealedKey)", { owner, agent: account.address }))
  .filter((l) => l.args.epoch === epoch).pop();
if (!grant) throw new Error(`No key sealed to this agent for epoch ${epoch}; ask the owner to grant or re-seal.`);
const s = hexToBytes(grant.args.sealedKey), eph = s.slice(1, 33), salt = new Uint8Array([...eph, ...me]);
const key = xc(kdf(x25519.getSharedSecret(secret, eph), salt, "MNEMO grant v1"), s.slice(33, 57)).decrypt(s.slice(57));
const gone = new Set((await logs("event Forgotten(address indexed owner, uint256 indexed id)", { owner })).map((l) => l.args.id));
for (const l of await logs("event Noted(address indexed owner, uint256 indexed id, uint32 epoch, bytes ciphertext)", { owner })) {
  if (l.args.epoch !== epoch || gone.has(l.args.id)) continue; const b = hexToBytes(l.args.ciphertext);
  console.log(`#${l.args.id}`, new TextDecoder().decode(xc(key, b.slice(1, 25)).decrypt(b.slice(25)))); }
if (note) { const nonce = crypto.getRandomValues(new Uint8Array(24)), ct = xc(key, nonce).encrypt(enc(note));
  await send(at("LaunchToken"), "approve", [vault, await pub.readContract({ address: vault, abi, functionName: "stamp" })]);
  const r = await send(vault, "writeFor", [owner, [bytesToHex(new Uint8Array([1, ...nonce, ...ct]))], epoch]); console.log("Sealed in", r.transactionHash); }
