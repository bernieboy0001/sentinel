import { Config } from "../config.js";
import { llmJson } from "../llm.js";
import { sizeMultiplier } from "../learn.js";
import { EngineOutput, Side, TrackingState } from "../types.js";

const TRADER_SYSTEM = `You are the TRADER agent of SENTINEL, an autonomous fund trading a demo AMM pool on Base testnet.
You propose ONE trade per cycle. You never invent numbers: every figure in your reasoning comes from the ENGINE JSON supplied to you.
Rules:
- "buy" means buy AUTH paying AUDS; "sell" means sell AUTH; "hold" means do nothing.
- A clear bullish engine grade MEANS buy, a clear bearish grade MEANS sell — that is your job, do not hesitate just because it feels risky. The risk auditor handles risk.
- TREND EXIT: a "reversal" is when BOTH short AND medium momentum have flipped or are turning negative while you hold AUTH — that is the time to sell and lock the gain or cut fast. A dip WITHIN a still-positive medium trend is NOT a reversal; keep the position.
- BUT the auditor caps AUTH exposure at 60% of treasury. If position.authShare is already near or above ~0.6, a buy will be blocked — so propose "sell" to take profit and rebalance instead, or hold.
- You may only "hold" on a neutral grade, or when treasury genuinely lacks the token needed.
- tracking.accuracy is your VERIFIED hit-rate over the last N graded decisions, computed only from the ledger. Treat it as your real skill level:
  - above ~0.6: you are in a hot streak — take the clear signals at good size.
  - below ~0.45: you are cold — shrink size, and only trade the strongest signals.
- sizePct is 5-20, the percent of treasury to deploy. Use a larger size when the engine is confident AND you are verified-hot.
- riskFlags: concrete concerns (high volatility, momentum exhaustion, thin liquidity).
- reason must cite actual engine signal values.
Respond ONLY with strict JSON, nothing else:
{"side":"buy"|"sell"|"hold","sizePct":number,"reason":"...","riskFlags":["..."],"toolsUsed":["engine","balances","ledger"]}`;

export interface ProposalInput {
  engine: EngineOutput;
  treasury: { auth: number; auds: number };
  tracking: TrackingState;
  position: { authShare: number };
  recentSides: Side[];
  /** Consecutive most-recent graded misses per side (executed calls only). */
  missStreak?: MissStreak;
}

export interface MissStreak {
  buy: number;
  sell: number;
}

export interface Proposal {
  side: Side;
  sizePct: number;
  reason: string;
  riskFlags: string[];
  toolsUsed: string[];
  llm: boolean;
}

function clampSize(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(20, Math.round(x)));
}

function normalizeSide(v: unknown): Side | null {
  if (v === "buy" || v === "sell" || v === "hold") return v;
  return null;
}

export async function proposeTrade(
  config: Config,
  input: ProposalInput
): Promise<Proposal> {
  let proposal: Proposal | null = null;
  const user = JSON.stringify({
    engine: input.engine,
    treasury: input.treasury,
    tracking: input.tracking,
    position: input.position,
    recentSides: input.recentSides
  });
  const json = await llmJson(config.llm, TRADER_SYSTEM, user);
  if (json) {
    const side = normalizeSide(json.side);
    if (side) {
      proposal = {
        side,
        sizePct: clampSize(Number(json.sizePct)),
        reason: String(json.reason ?? ""),
        riskFlags: Array.isArray(json.riskFlags)
          ? json.riskFlags.map(String)
          : [],
        toolsUsed: Array.isArray(json.toolsUsed)
          ? json.toolsUsed.map(String)
          : ["engine"],
        llm: true
      };
    }
  }

  if (!proposal) {
    // Deterministic fallback — the system works even with no LLM.
    // It adapts: verified-hot → press the edge; cold → shrink and stand down
    // unless the signal is unmistakable. This is engine-computed, never guessed.
    const g = input.engine.grade;
    const cold = input.tracking.samples >= 8 && input.tracking.accuracy <= 0.45;
    const scale = sizeMultiplier(input.tracking);
    let side: Side = "hold";
    let sizePct = 0;
    const strength = Math.abs(input.engine.score);

    // Reversal exit: the medium trend itself has turned against a no-short-only
    // dip. Real reversals, not pullbacks. A pullback with medium momentum still
    // positive is a hold — cutting there turns winners into small misses.
    const shortV = input.engine.signals.find((s) => s.key === "short_momentum")?.value ?? 0;
    const medV = input.engine.signals.find((s) => s.key === "medium_momentum")?.value ?? 0;

    if (medV < 0.05 && shortV < -0.12 && input.position.authShare >= 0.35) {
      side = "sell";
      sizePct = clampSize((7 + Math.round(strength * 12)) * scale);
    } else if (g === "bullish" && !(cold && strength < 0.3)) {
      side = "buy";
      sizePct = clampSize((8 + Math.round(strength * 12)) * scale);
    } else if (g === "bearish" && !(cold && strength < 0.3)) {
      side = "sell";
      sizePct = clampSize((8 + Math.round(strength * 12)) * scale);
    }
    // Already concentrated? A buy would be exposure-blocked anyway. Turn it
    // into a rebalance sell (or stand down) instead of banging on a locked door.
    if (side === "buy" && input.position.authShare >= 0.6) {
      side = "hold";
      sizePct = 0;
    }
    proposal = {
      side,
      sizePct,
      reason: `Deterministic fallback (no LLM): engine grade ${g}, score ${strength.toFixed(3)}, verified hit-rate ${(input.tracking.accuracy * 100).toFixed(0)}% over ${input.tracking.samples} graded calls`,
      riskFlags: [],
      toolsUsed: ["engine"],
      llm: false
    };
  }

  if (config.conviction === "high") {
    return highConvictionGate(input.engine, proposal, input.missStreak);
  }
  return proposal;
}

/**
 * CONVICTION=high: trade only in an unambiguous market, and throttle otherwise.
 * The proposal is downgraded to a recorded hold — with a machine-checkable
 * reason — while momentum does not agree in the proposal's direction, the
 * signal is below a stiffer floor, volatility is genuinely violent, or the
 * fund's own recent calls on that side are a cascade of misses. When the trend
 * is stretched but still firmly moving with us, the gate does NOT freeze: it
 * throttles size to a token amount so a clean trend is still played, just
 * cautiously. The guard sits at the source so the LLM (or the fallback) can
 * never talk its way into a low-quality trade.
 */
export function highConvictionGate(
  engine: EngineOutput,
  proposal: Proposal,
  streak?: MissStreak
): Proposal {
  if (proposal.side === "hold") return proposal;

  const sig = (k: string) => engine.signals.find((s) => s.key === k)?.value ?? 0;
  const shortV = sig("short_momentum");
  const medV = sig("medium_momentum");
  const reversionV = sig("mean_reversion");
  const vol = sig("volatility");
  const strength = Math.abs(engine.score);

  const blockers: string[] = [];
  const agreeing =
    proposal.side === "buy"
      ? shortV > 0.04 && medV > 0.04
      : shortV < -0.04 && medV < -0.04;
  if (!agreeing) {
    blockers.push("short and medium momentum do not agree in that direction");
  }
  if (strength < 0.32) {
    blockers.push(`signal strength ${engine.score.toFixed(3)} is below the 0.32 high-conviction floor`);
  }
  const stretchedBuy = proposal.side === "buy" && reversionV < -0.6;
  const stretchedSell = proposal.side === "sell" && reversionV > 0.6;
  const fading =
    proposal.side === "buy" ? medV < 0.25 : medV > -0.25;
  if ((stretchedBuy || stretchedSell) && fading) {
    blockers.push(
      proposal.side === "buy"
        ? "price is stretched far above its trend and momentum is already fading — that is buying a top"
        : "price is washed out far below its trend and momentum is already fading — that is selling a bottom"
    );
  }
  if (vol <= -0.5) {
    blockers.push("volatility is extreme");
  }
  const sameSideMisses =
    proposal.side === "buy" ? streak?.buy ?? 0 : streak?.sell ?? 0;
  if (sameSideMisses >= 2) {
    blockers.push(`the last ${sameSideMisses} graded calls on this side were misses`);
  }

  if (blockers.length) {
    return {
      ...proposal,
      side: "hold",
      sizePct: 0,
      reason: `[high-conviction] stood down: ${blockers.join("; ")}. Engine grade was ${engine.grade}, score ${engine.score.toFixed(3)}.`,
      riskFlags: [...proposal.riskFlags, "conviction_hold"]
    };
  }

  // Stretched but still firmly moving with us: play it small instead of
  // skipping it — restraint without paralysis.
  if (stretchedBuy || stretchedSell) {
    return {
      ...proposal,
      sizePct: Math.min(proposal.sizePct, 5),
      reason: proposal.reason.includes("[high-conviction]")
        ? proposal.reason
        : `[high-conviction] trend stretched — size throttled to ${Math.min(proposal.sizePct, 5)}%. ${proposal.reason}`,
      riskFlags: [...proposal.riskFlags, "throttled_for_stretch"]
    };
  }
  return proposal;
}
