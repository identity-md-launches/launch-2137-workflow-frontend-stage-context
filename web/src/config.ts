/**
 * The site's single configuration. Addresses, the chain, ABIs, public RPCs and the Uniswap
 * contracts all come from `imd-deployment.json`, the file published beside index.html, which is
 * copied from the attested deployment handoff and `.imd/reads/network.json`. Nothing here keeps a
 * second map that could disagree with it.
 */
import { createConfig, fallback, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { createPublicClient, defineChain, getAddress, type Abi, type Address, type Chain, type PublicClient } from "viem";

export const SITE_NAME = "MNEMO";
export const SITE_DESCRIPTION = "Your AI's memory, sealed on chain. Notes encrypted in your browser, stored on Ethereum as ciphertext.";

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export type Network = {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
    extendedSwapParams?: boolean;
  };
  pairToken?: { address: Address; symbol: string; name: string; decimals: number };
  otherPairTokens?: { id: string; address: Address; symbol: string; name: string; decimals: number }[];
};

export type DeploymentFile = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network?: Network;
  walletAddChain?: Record<string, unknown>;
};

export type Deployment = {
  file: DeploymentFile;
  chain: Chain;
  network: Network | undefined;
  /** Uniswap addresses are only trusted from the network block; absent means swaps stay off. */
  swapsEnabled: boolean;
  token: { address: Address; abi: Abi };
  vault: { address: Address; abi: Abi };
  /** Block of the vault's deployment: event scans start here. */
  fromBlock: bigint;
  poolKey: PoolKey | undefined;
  pairToken: { address: Address; symbol: string; decimals: number } | undefined;
  explorer: string;
};

/** Deployment block from the handoff (both contracts were created in one transaction). */
const DEPLOY_BLOCK = 26216887n;

export async function loadDeployment(base = "./"): Promise<Deployment> {
  const res = await fetch(`${base}imd-deployment.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`imd-deployment.json could not be loaded (HTTP ${res.status}).`);
  const file = (await res.json()) as DeploymentFile;
  const abiOf = async (name: string) => {
    const c = file.contracts.find((x) => x.name === name);
    if (!c) throw new Error(`imd-deployment.json has no ${name} contract.`);
    if (c.abiPath.includes("..") || /^[a-z]+:/i.test(c.abiPath)) throw new Error(`Refusing ABI path ${c.abiPath}.`);
    const r = await fetch(`${base}${c.abiPath}`);
    if (!r.ok) throw new Error(`${c.abiPath} could not be loaded (HTTP ${r.status}).`);
    return { address: getAddress(c.address), abi: (await r.json()) as Abi };
  };
  const [token, vault] = await Promise.all([abiOf("LaunchToken"), abiOf("MnemoVault")]);
  const network = file.network;
  const rpcUrls = network?.rpcUrls ?? [];
  const chain = defineChain({
    id: file.chainId,
    name: network?.name ?? `Chain ${file.chainId}`,
    nativeCurrency: network?.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpcUrls } },
    blockExplorers: network ? { default: { name: "Explorer", url: network.explorer } } : undefined,
    testnet: network?.testnet,
  });
  const pairAddr = file.poolKey
    ? [file.poolKey.currency0, file.poolKey.currency1].find((a) => a.toLowerCase() !== token.address.toLowerCase())
    : undefined;
  const pairMeta = [network?.pairToken, ...(network?.otherPairTokens ?? [])].find(
    (t) => t && pairAddr && t.address.toLowerCase() === pairAddr.toLowerCase(),
  );
  return {
    file,
    chain,
    network,
    swapsEnabled: !!network && !!file.poolKey && !!pairMeta && rpcUrls.length > 0,
    token,
    vault,
    fromBlock: DEPLOY_BLOCK,
    poolKey: file.poolKey,
    pairToken: pairMeta ? { address: getAddress(pairMeta.address), symbol: pairMeta.symbol, decimals: pairMeta.decimals } : undefined,
    explorer: network?.explorer ?? "",
  };
}

export function makeTransport(d: Deployment) {
  const urls = d.network?.rpcUrls ?? [];
  return fallback(urls.map((u) => http(u, { batch: { wait: 16 }, retryCount: 1 })));
}

export function makePublicClient(d: Deployment): PublicClient {
  return createPublicClient({ chain: d.chain, transport: makeTransport(d) }) as PublicClient;
}

export function makeWagmiConfig(d: Deployment) {
  return createConfig({
    chains: [d.chain],
    // EIP-6963 discovery lists every installed extension under its own name.
    multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
    transports: { [d.chain.id]: makeTransport(d) },
  });
}

export const explorerAddress = (d: Deployment, a: string) => (d.explorer ? `${d.explorer}/address/${a}` : "");
export const explorerTx = (d: Deployment, h: string) => (d.explorer ? `${d.explorer}/tx/${h}` : "");
