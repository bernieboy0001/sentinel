import { Config } from "./config.js";
import { Chain, doSwap, getReserves } from "./chain.js";

/**
 * Demo market maker. In the sandbox there is no external trader, so this bot
 * creates honest price movement the agent reacts to. It alternates between
 * choppy noise and short trends so the agent's signals actually fire.
 * Turn it off (`MARKET_MAKER=off`) to run against a real market.
 */

let trendDir = 0;
let trendRemaining = 0;
let coastRemaining = 0;
let running = false;

export async function marketMakerTick(
  chain: Chain,
  config: Config
): Promise<void> {
  if (running) return;
  running = true;
  try {
    const [r0, r1] = await getReserves(chain);
    let frac: number;
    let dir: number;

    if (trendRemaining > 0) {
      dir = trendDir;
      frac = 0.006 + Math.random() * 0.008;
      trendRemaining--;
      if (trendRemaining === 0) {
        // Settle phase: keep drifting the same way, quietly, so a move is
        // readable by the medium-timeframe signal instead of snapping back.
        coastRemaining = 8 + Math.floor(Math.random() * 5);
      }
    } else if (coastRemaining > 0) {
      dir = trendDir;
      frac = 0.0015 + Math.random() * 0.0025;
      coastRemaining--;
    } else {
      dir = Math.random() > 0.5 ? 1 : -1;
      const roll = Math.random();
      if (roll < 0.35) {
        trendDir = dir;
        trendRemaining = 8 + Math.floor(Math.random() * 7);
        frac = 0.006 + Math.random() * 0.008;
      } else {
        frac = 0.004 + Math.random() * 0.006;
      }
    }

    // dir > 0 buys AUTH (pays AUDS) so the AUTH price rises.
    const tokenIn: "auth" | "auds" = dir > 0 ? "auds" : "auth";
    const sideReserve = dir > 0 ? r1 : r0;
    const amountIn = (sideReserve * BigInt(Math.round(frac * 10_000))) / 10_000n;
    if (amountIn <= 0n) return;

    await doSwap(chain, tokenIn, amountIn, 0n, chain.mm);
  } finally {
    running = false;
  }
}

export function startMarketMaker(
  chain: Chain,
  config: Config
): NodeJS.Timeout {
  if (!config.marketMakerEnabled) {
    console.log("[SENTINEL] market maker disabled");
    return null as unknown as NodeJS.Timeout;
  }
  const ms = Math.max(1500, Math.round(config.cycleMs / 3));
  console.log(`[SENTINEL] market maker started (every ${ms}ms)`);
  return setInterval(() => {
    marketMakerTick(chain, config).catch((e) =>
      console.warn("[mm] tick failed:", (e as Error).message)
    );
  }, ms);
}
