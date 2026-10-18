/** Reads from the vault: event scans with chunk fallback, and a readable revert reason. */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

export const NOTED = parseAbiItem("event Noted(address indexed owner, uint256 indexed id, uint32 epoch, bytes ciphertext)");
export const FORGOTTEN = parseAbiItem("event Forgotten(address indexed owner, uint256 indexed id)");
export const GRANTED = parseAbiItem("event Granted(address indexed owner, address indexed agent, uint32 epoch, bytes sealedKey)");
export const REVOKED = parseAbiItem("event Revoked(address indexed owner, address indexed agent)");

type Ev = typeof NOTED | typeof FORGOTTEN | typeof GRANTED | typeof REVOKED;

/** getLogs over [from, latest]; public RPCs refuse wide ranges, so split on refusal. */
export async function scan<E extends Ev>(
  client: PublicClient,
  address: Address,
  event: E,
  args: Record<string, unknown> | undefined,
  from: bigint,
) {
  const latest = await client.getBlockNumber();
  const get = (fromBlock: bigint, toBlock: bigint) =>
    client.getLogs({ address, event, args: args as never, fromBlock, toBlock } as never) as unknown as Promise<
      { args: Record<string, unknown>; blockNumber: bigint; logIndex: number }[]
    >;
  try {
    return await get(from, latest);
  } catch {
    const out: Awaited<ReturnType<typeof get>> = [];
    const step = 10_000n;
    for (let a = from; a <= latest; a += step) {
      const b = a + step - 1n > latest ? latest : a + step - 1n;
      out.push(...(await get(a, b)));
    }
    return out;
  }
}

export type NoteLog = { id: bigint; epoch: number; ciphertext: Hex };

export async function readNotes(client: PublicClient, vault: Address, owner: Address, from: bigint): Promise<NoteLog[]> {
  const [noted, forgotten] = await Promise.all([
    scan(client, vault, NOTED, { owner }, from),
    scan(client, vault, FORGOTTEN, { owner }, from),
  ]);
  const gone = new Set(forgotten.map((l) => String(l.args.id)));
  return noted
    .filter((l) => !gone.has(String(l.args.id)))
    .map((l) => ({ id: l.args.id as bigint, epoch: Number(l.args.epoch), ciphertext: l.args.ciphertext as Hex }));
}

/** Distinct vault owners that have sealed at least one note: a count, never a list shown. */
export async function countVaults(client: PublicClient, vault: Address, from: bigint): Promise<number> {
  const noted = await scan(client, vault, NOTED, undefined, from);
  return new Set(noted.map((l) => String(l.args.owner).toLowerCase())).size;
}

export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError) || /rejected|denied/i.test(e.message)) return "You rejected the request in your wallet.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev?.data?.errorName) {
      const args = rev.data.args?.map(String).join(", ");
      return `The contract refused: ${rev.data.errorName}${args ? `(${args})` : ""}.`;
    }
    if (rev?.reason) return `The contract refused: ${rev.reason}.`;
    return e.shortMessage;
  }
  if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 4001) return "You rejected the request in your wallet.";
  return e instanceof Error ? e.message : String(e);
}
