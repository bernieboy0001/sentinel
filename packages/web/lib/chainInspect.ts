import { ethers } from "ethers";
import type { InspectionResult } from "./types";

const MAINNET_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

const RPCS = [
  "https://base.llamarpc.com",
  "https://1rpc.io/base",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org"
];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("RPC timed out")), ms))
  ]);
}

function fmt(wei: string | undefined, decimals: number | null): string {
  if (!wei) return "0";
  const b = BigInt(wei);
  const d = decimals ?? 18;
  if (d <= 0 || b === 0n) return b.toString();
  const whole = b / 10n ** BigInt(d);
  const frac = b % 10n ** BigInt(d);
  if (frac === 0n) return whole.toString();
  const fr = frac.toString().padStart(d, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole}.${fr}`;
}

async function inspectOn(url: string, addr: string): Promise<InspectionResult> {
  const provider = new ethers.JsonRpcProvider(url);
  const get = <T>(p: Promise<T>) => withTimeout(p, 8000);

  const code = await get(provider.getCode(addr));
  const isContract = code !== "0x";
  const base: InspectionResult = {
    target: addr,
    chain: "Base mainnet",
    isContract,
    agent: "",
    note: ""
  };

  if (!isContract) {
    const eth = await get(provider.getBalance(addr));
    base.eth = fmt(eth.toString(), 18);
    base.note = `${addr} is a plain wallet holding ${base.eth} ETH on Base mainnet, read straight off the chain in your browser — no guesses.`;
    return base;
  }

  const erc = new ethers.Contract(addr, MAINNET_ABI, provider);
  let symbol = "";
  let name = "";
  let decimals: number | null = null;
  try {
    symbol = String((await get(erc.symbol())) ?? "");
    name = String((await get(erc.name())) ?? "");
    decimals = Number(await get(erc.decimals()));
  } catch {
    /* not a readable ERC-20 */
  }

  base.symbol = symbol || "—";
  base.name = name || undefined;
  base.decimals = decimals;

  if (symbol) {
    base.note = `Token ${name ? name + " " : ""}(${symbol}) on Base mainnet. SENTINEL verified its metadata and code directly from the chain in your browser. SENTINEL only ever trades its own market token (AUTH) — it audits the rest without pretending to trade them.`;
  } else {
    base.note = "A deployed contract on Base mainnet, but not an ERC-20 SENTINEL knows how to read. SENTINEL says so instead of guessing.";
  }
  return base;
}

/** Audits any address on Base mainnet, right from the visitor's browser. */
export async function inspectMainnet(
  target: string
): Promise<InspectionResult> {
  const addr = ethers.getAddress(target.trim());
  let lastErr: unknown = null;
  for (const url of RPCS) {
    try {
      return await inspectOn(url, addr);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`couldn't reach a mainnet node: ${(lastErr as Error)?.message ?? lastErr}`);
}