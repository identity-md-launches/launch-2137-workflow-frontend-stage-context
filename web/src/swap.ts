/**
 * Uniswap v4 swap encoding for the launch pool, through the Universal Router named in the
 * deployment's network block. Quotes come from that block's quoter by simulation, never a
 * transaction.
 */
import { encodeAbiParameters, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import type { PoolKey } from "./config";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

export const PERMIT2_ABI = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

export const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

/** V4_SWAP command, and SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL actions. */
export const V4_SWAP: Hex = "0x10";
export const ACTIONS: Hex = "0x060c0f";

const POOL_KEY = "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";

export function applySlippage(quoted: bigint, bps: number): bigint {
  if (bps < 0 || bps > 5000) throw new Error("Slippage must be between 0% and 50%.");
  return (quoted * BigInt(10000 - Math.round(bps))) / 10000n;
}

export function encodeSwap(args: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  extended?: boolean;
}): { commands: Hex; inputs: Hex[] } {
  const { poolKey, zeroForOne, amountIn, amountOutMinimum, extended } = args;
  const key = [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks] as const;
  const swapParams = extended
    ? encodeAbiParameters(
        parseAbiParameters(`(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)`),
        [{ poolKey: tupleKey(key), zeroForOne, amountIn, amountOutMinimum, minHopPriceX36: 0n, hookData: "0x" }],
      )
    : encodeAbiParameters(parseAbiParameters(`(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`), [
        { poolKey: tupleKey(key), zeroForOne, amountIn, amountOutMinimum, hookData: "0x" },
      ]);
  const input: Address = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const output: Address = zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const settle = encodeAbiParameters(parseAbiParameters("address, uint256"), [input, amountIn]);
  const take = encodeAbiParameters(parseAbiParameters("address, uint256"), [output, amountOutMinimum]);
  const v4Input = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [ACTIONS, [swapParams, settle, take]]);
  return { commands: V4_SWAP, inputs: [v4Input] };
}

function tupleKey(k: readonly [Address, Address, number, number, Address]) {
  return { currency0: k[0], currency1: k[1], fee: k[2], tickSpacing: k[3], hooks: k[4] };
}
