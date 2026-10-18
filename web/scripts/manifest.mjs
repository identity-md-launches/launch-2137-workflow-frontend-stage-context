// Writes dist/imd-deployment.json after `vite build`: identifiers, contracts and poolKey from the
// deployment handoff, network and walletAddChain from network.json, and a SHA-256 for every other
// exported file. Refuses to write when an exported ABI does not match the handoff's abiHash.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const handoff = JSON.parse(readFileSync(join(here, "..", "deployment", "handoff.json"), "utf8"));
const net = JSON.parse(readFileSync(join(here, "..", "deployment", "network.json"), "utf8"));

const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
      : JSON.stringify(v);
export const abiHash = (abi) => keccak256(toHex(canon(abi))).slice(2);

const contracts = handoff.contracts.map((c) => {
  const abiPath = `abi/${c.name}.json`;
  const abi = JSON.parse(readFileSync(join(dist, abiPath), "utf8"));
  if (!Array.isArray(abi)) throw new Error(`${abiPath} is not a raw ABI array`);
  const h = abiHash(abi);
  if (h !== c.abiHash) throw new Error(`${abiPath} hash ${h} does not match handoff ${c.abiHash}`);
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);
const assets = files
  .map((p) => relative(dist, p).split("\\").join("/"))
  .filter((p) => p !== "imd-deployment.json")
  .map((path) => {
    const bytes = readFileSync(join(dist, path));
    if (bytes.length > 8 * 1024 * 1024) throw new Error(`${path} is over 8 MiB`);
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
if (!assets.some((a) => a.path === "index.html")) throw new Error("dist/index.html is missing");
if (assets.length > 128) throw new Error(`${assets.length} assets; the limit is 128`);

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  ...(net.network ? { network: net.network } : {}),
  ...(net.walletAddChain ? { walletAddChain: net.walletAddChain } : {}),
};
writeFileSync(join(dist, "imd-deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
const total = assets.reduce((s, a) => s + statSync(join(dist, a.path)).size, 0);
console.log(`imd-deployment.json: ${contracts.length} contracts, ${assets.length} assets, ${(total / 1024).toFixed(0)} KiB`);
