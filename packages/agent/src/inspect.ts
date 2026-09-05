import { ethers } from "ethers";
import { Chain, ERC20_ABI } from "./chain.js";
import { getBalances, getPriceNum } from "./chain.js";
import { InspectionResult } from "./types.js";

const META_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

const CALL_TIMEOUT_MS = 7000;

function fmtRawBalance(wei: string | undefined, decimals: number | null): string {
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`RPC timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function inspectOn(
  chain: Chain,
  addr: string,
  agentAddr: string,
  rpcUrl: string,
  chainLabel: string
): Promise<InspectionResult> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const get = <T>(pr: Promise<T>) => withTimeout(pr, CALL_TIMEOUT_MS);

  const code = await get(provider.getCode(addr));
  const isContract = code !== "0x";

  const base: InspectionResult = {
    target: addr,
    chain: chainLabel,
    isContract,
    agent: agentAddr,
    note: ""
  };

  if (!isContract) {
    const eth = await get(provider.getBalance(addr));
    base.eth = fmtRawBalance(eth.toString(), 18);
    base.note = `${addr} is a plain wallet holding ${base.eth} ETH on ${chainLabel}. SENTINEL read that directly — no guesses.`;
    return base;
  }

  const { auth, auds } = chain.tokens;
  const isAuth = addr.toLowerCase() === auth.toLowerCase();
  const isAuds = addr.toLowerCase() === auds.toLowerCase();

  if (isAuth || isAuds) {
    const sym = isAuth ? "AUTH" : "AUDS";
    const price = await getPriceNum(chain);
    const bal = await getBalances(chain, agentAddr);
    base.inMarket = sym;
    base.symbol = sym;
    base.name = sym === "AUTH" ? "SENTINEL Vector Token" : "SENTINEL Stable";
    base.decimals = 18;
    base.price = price;
    base.agentBalance = (isAuth ? bal.auth : bal.auds).toString();
    base.note = `${
      base.name
    } (${sym}) is SENTINEL's own market token on its testnet. Live AMM price ${price.toFixed(
      4
    )} — read from the swap contract, not a feed.`;
    return base;
  }

  const erc = new ethers.Contract(addr, META_ABI, provider);
  let symbol = "";
  let name = "";
  let decimals: number | null = null;
  try {
    symbol = String((await get(erc.symbol())) ?? "");
    name = String((await get(erc.name())) ?? "");
    decimals = Number(await get(erc.decimals()));
  } catch {
    // not an ERC-20 — leave fields empty
  }

  let agentBalance = "";
  try {
    agentBalance = (await get(erc.balanceOf(agentAddr))) as string;
  } catch {
    agentBalance = "0";
  }

  base.symbol = symbol || "—";
  base.name = name || undefined;
  base.decimals = decimals;
  base.agentBalance = agentBalance;

  if (symbol) {
    base.note = `Token ${name ? name + " " : ""}(${symbol}) is not in SENTINEL's demo market, so SENTINEL won't pretend to price it on ${chainLabel}. The balance shown above was read on-chain: ${fmtRawBalance(
      agentBalance,
      decimals
    )} ${symbol}.`;
  } else {
    base.note = `A deployed contract on ${chainLabel}, but not an ERC-20 SENTINEL knows how to price. SENTINEL says so instead of guessing.`;
  }

  return base;
}

/**
 * The "audit anything" primitive: give SENTINEL any address and it reads the
 * truth straight off the chain. Tries each public RPC in order so a slow node
 * never stalls the request, and always returns an answer — never a hang.
 */
export async function inspectAddress(
  chain: Chain,
  target: string,
  opts: { rpcUrls: string[]; chainLabel: string }
): Promise<InspectionResult> {
  const addr = ethers.getAddress(target);
  const agentAddr = await chain.agent.getAddress();
  let lastErr: unknown = null;
  for (const url of opts.rpcUrls) {
    try {
      return await inspectOn(chain, addr, agentAddr, url, opts.chainLabel);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`network unreachable: ${(lastErr as Error)?.message ?? lastErr}`);
}