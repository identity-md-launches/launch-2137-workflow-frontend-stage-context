// Verify a hosted export against the exact locally built bundle. No credentials or signing.
// node web/scripts/verify-published.mjs https://mnemo.site.identitymd.eth.limo/
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node web/scripts/verify-published.mjs <published site URL>");
  process.exit(1);
}
const base = new URL(target.endsWith("/") ? target : `${target}/`);
const expected = JSON.parse(readFileSync(fileURLToPath(new URL("../../dist/imd-deployment.json", import.meta.url)), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fetchFile = async (path) => {
  const response = await fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

try {
  const published = JSON.parse((await fetchFile("imd-deployment.json")).toString("utf8"));
  if (JSON.stringify(published) !== JSON.stringify(expected)) throw new Error("The published deployment manifest differs from this build.");
  for (let i = 0; i < expected.assets.length; i += 4) {
    await Promise.all(expected.assets.slice(i, i + 4).map(async (asset) => {
      const bytes = await fetchFile(asset.path);
      if (hash(bytes) !== asset.sha256) throw new Error(`${asset.path}: published bytes differ from this build.`);
    }));
  }
  console.log(`PASS ${base.href}: manifest and all ${expected.assets.length} runtime files match this production build.`);
} catch (error) {
  console.error(`FAIL ${base.href}: ${error.message}`);
  process.exitCode = 1;
}
