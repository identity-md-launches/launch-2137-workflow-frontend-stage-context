import { describe, expect, it } from "vitest";
import { decodeAbiParameters, parseAbiParameters, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentPublic, agentSecret, MAX_NOTE_BYTES, MAX_PLAINTEXT_BYTES, openNote, openSealedKey, sealKeyFor, sealNote, vaultKey, vaultMessage } from "../src/crypto";
import { ACTIONS, applySlippage, encodeSwap, V4_SWAP } from "../src/swap";
import { splitReply, systemPrompt } from "../src/Chat";
import handoff from "../deployment/handoff.json";

// A throwaway key used only in these tests (Hardhat's well-known account 0).
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("vault keys and notes", () => {
  it("derives the same key from the same EOA signature, different keys per epoch", async () => {
    const sig1 = await owner.signMessage({ message: vaultMessage(owner.address) });
    const sig2 = await owner.signMessage({ message: vaultMessage(owner.address) });
    expect(sig1).toBe(sig2);
    expect(await recoverMessageAddress({ message: vaultMessage(owner.address), signature: sig1 })).toBe(owner.address);
    expect(vaultKey(sig1, 0)).toEqual(vaultKey(sig2, 0));
    expect(vaultKey(sig1, 0)).not.toEqual(vaultKey(sig1, 1));
  });

  it("round-trips a note and refuses another epoch's key", async () => {
    const sig = await owner.signMessage({ message: vaultMessage(owner.address) });
    const ct = sealNote(vaultKey(sig, 3), "I prefer short answers");
    expect(openNote(vaultKey(sig, 3), ct)).toBe("I prefer short answers");
    expect(openNote(vaultKey(sig, 2), ct)).toBeNull();
    expect(ct.startsWith("0x01")).toBe(true);
  });

  it("fits the contract's 2,048-byte limit at the plaintext maximum and refuses one byte more", () => {
    const k = new Uint8Array(32).fill(7);
    const ct = sealNote(k, "a".repeat(MAX_PLAINTEXT_BYTES));
    expect((ct.length - 2) / 2).toBe(MAX_NOTE_BYTES);
    expect(() => sealNote(k, "a".repeat(MAX_PLAINTEXT_BYTES + 1))).toThrow();
    expect(() => sealNote(k, "")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const k = new Uint8Array(32).fill(1);
    const ct = sealNote(k, "hello");
    const bad = (ct.slice(0, -2) + (ct.endsWith("00") ? "01" : "00")) as `0x${string}`;
    expect(openNote(k, bad)).toBeNull();
  });
});

describe("agent grants", () => {
  it("seals the vault key to the agent's registered key and only that agent opens it", async () => {
    const secret = agentSecret(await agent.signMessage({ message: `MNEMO agent key v1 for ${agent.address}` }));
    const other = agentSecret(await owner.signMessage({ message: `MNEMO agent key v1 for ${owner.address}` }));
    const key = new Uint8Array(32).fill(9);
    const sealed = sealKeyFor(agentPublic(secret), key);
    expect((sealed.length - 2) / 2).toBe(1 + 32 + 24 + 48);
    expect(openSealedKey(secret, sealed)).toEqual(key);
    expect(openSealedKey(other, sealed)).toBeNull();
  });
});

describe("swap encoding", () => {
  const poolKey = handoff.poolKey as never as Parameters<typeof encodeSwap>[0]["poolKey"];
  it("encodes V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL and the handoff's pool key", () => {
    const { commands, inputs } = encodeSwap({ poolKey, zeroForOne: false, amountIn: 10n ** 18n, amountOutMinimum: 5n });
    expect(commands).toBe(V4_SWAP);
    const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), inputs[0]);
    expect(actions).toBe(ACTIONS);
    expect(params).toHaveLength(3);
    const [swap] = decodeAbiParameters(
      parseAbiParameters("((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)"),
      params[0],
    );
    expect(swap.poolKey.hooks.toLowerCase()).toBe(handoff.poolKey.hooks);
    expect(swap.poolKey.fee).toBe(12500);
    expect(swap.poolKey.tickSpacing).toBe(60);
    expect(swap.zeroForOne).toBe(false);
    const [settleCur, settleAmt] = decodeAbiParameters(parseAbiParameters("address, uint256"), params[1]);
    const [takeCur, takeAmt] = decodeAbiParameters(parseAbiParameters("address, uint256"), params[2]);
    // Buying MNEMO (currency0) spends IMD (currency1).
    expect(settleCur.toLowerCase()).toBe(handoff.poolKey.currency1);
    expect(settleAmt).toBe(10n ** 18n);
    expect(takeCur.toLowerCase()).toBe(handoff.poolKey.currency0);
    expect(takeAmt).toBe(5n);
  });

  it("applies slippage in basis points and refuses nonsense", () => {
    expect(applySlippage(10000n, 100)).toBe(9900n);
    expect(applySlippage(10000n, 0)).toBe(10000n);
    expect(() => applySlippage(1n, 6000)).toThrow();
  });
});

describe("chat memory proposals", () => {
  it("splits proposals out of the reply", () => {
    const r = splitReply("Sure, noted.\n<remember>\n- Lives in Lisbon\n- Allergic to nuts\n</remember>");
    expect(r.reply).toBe("Sure, noted.");
    expect(r.proposals).toEqual(["Lives in Lisbon", "Allergic to nuts"]);
    expect(splitReply("Just an answer").proposals).toEqual([]);
  });
  it("puts remembered notes in the system prompt", () => {
    expect(systemPrompt(["Likes tea"])).toContain("- Likes tea");
  });
});
