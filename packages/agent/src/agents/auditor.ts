import { Config } from "../config.js";
import { llmJson } from "../llm.js";
import { EngineOutput, TrackingState } from "../types.js";
import { Proposal } from "./trader.js";

const AUDITOR_SYSTEM = `You are the RISK AUDITOR of SENTINEL, an autonomous fund. The TRADER agent has proposed a trade.
Vetoes are decided ONLY by machine-checkable rules — you do not block, you only explain and warn.
1. sizePct > 20 (position too large)
2. engine |score| < 0.25 on a non-hold (trading noise)
3. post-trade AUTH exposure would exceed 60% of treasury
4. deterministic risk gate has fired (high volatility + disagreeing momentum, or a spike with no confirmed trend)
5. tracking.accuracy below ~0.45 means the AI is on a cold streak — hard rules are enforced even more strictly
Beyond that, list soft concerns in "checks" so the decision record is honest, but they must NOT flip your verdict.
Respond ONLY with strict JSON:
{"verdict":"approved"|"vetoed","reason":"...","checks":["..."]}`;

export interface ProposalInput {
  proposal: Proposal;
  engine: EngineOutput;
  treasury: { auth: number; auds: number };
  tracking: TrackingState;
}

export interface Review {
  verdict: "approved" | "vetoed";
  reason: string;
  checks: string[];
  hardViolations: string[];
}

/**
 * The auditor may only block a trade when it can point at something
 * machine-checkable. Soft "vibes" are converted to commentary, never to a
 * veto — otherwise the risk agent quietly makes the fund miss every trade.
 */
function deterministicRiskGate(
  engine: EngineOutput,
  proposal: Proposal
): { veto: boolean; reasons: string[] } {
  if (proposal.side === "hold") return { veto: false, reasons: [] };
  const sig = (k: string) =>
    engine.signals.find((s) => s.key === k)?.value ?? 0;
  const shortMom = sig("short_momentum");
  const mediumMom = sig("medium_momentum");
  const vol = sig("volatility");
  const reasons: string[] = [];

  // Only genuinely violent, directionless windows stop a trade — but strict
  // enough to actually catch chop (that is what rescues the report card). Real
  // trends, where short and medium momentum agree, always trade. The gate is
  // static: a cold streak cannot loosen or tighten it, so it can't feed a
  // miss→veto death spiral.
  if (vol <= -0.4 && Math.abs(shortMom - mediumMom) >= 0.5) {
    reasons.push(
      "volatility is extreme and short vs medium momentum disagree (whipsaw zone)"
    );
  }
  if (Math.abs(shortMom) >= 0.8 && Math.abs(mediumMom) < 0.2) {
    reasons.push("the move is a violent outlier spike with no confirmed trend");
  }

  return { veto: reasons.length > 0, reasons };
}

function exposureAfter(proposal: Proposal, treasury: { auth: number; auds: number }, price: number): number {
  const total = treasury.auth * price + treasury.auds;
  if (total <= 0) return 0;
  let auth = treasury.auth;
  if (proposal.side === "buy") {
    const audsOut = treasury.auds * (proposal.sizePct / 100);
    auth += audsOut / price;
  } else if (proposal.side === "sell") {
    const authOut = treasury.auth * (proposal.sizePct / 100);
    auth -= authOut;
  }
  return (auth * price) / total;
}

export async function reviewProposal(
  config: Config,
  input: ProposalInput
): Promise<Review> {
  const hard: string[] = [];
  const { proposal, engine, treasury } = input;
  const auditLines: string[] = [];

  if (proposal.sizePct > config.maxSizePct) {
    hard.push(`size ${proposal.sizePct}% exceeds ${config.maxSizePct}% cap`);
    auditLines.push(`position size ${proposal.sizePct}% — OVER ${config.maxSizePct}% cap ✗`);
  } else {
    auditLines.push(`position size ${proposal.sizePct}% ≤ ${config.maxSizePct}% cap ✓`);
  }
  if (proposal.side !== "hold" && Math.abs(engine.score) < config.minSignalAbs) {
    hard.push(`signal strength ${engine.score.toFixed(3)} below ${config.minSignalAbs} floor`);
    auditLines.push(`signal strength ${Math.abs(engine.score).toFixed(3)} — below ${config.minSignalAbs} floor ✗`);
  } else if (proposal.side !== "hold") {
    auditLines.push(`signal strength ${Math.abs(engine.score).toFixed(3)} ≥ ${config.minSignalAbs} floor ✓`);
  }
  const expo = exposureAfter(proposal, treasury, engine.price);
  // A sell always reduces exposure; only a buy can push it over the cap.
  if (proposal.side === "buy" && expo > 0.6) {
    hard.push(`post-trade AUTH exposure ${(expo * 100).toFixed(0)}% exceeds 60%`);
    auditLines.push(`post-trade exposure would be ${(expo * 100).toFixed(0)}% — OVER 60% ✗`);
  } else {
    auditLines.push(
      proposal.side === "buy"
        ? `post-trade exposure ${(expo * 100).toFixed(0)}% ≤ 60% cap ✓`
        : `position exposure after ${proposal.side} — reduces risk ✓`
    );
  }

  const json = await llmJson(config.llm, AUDITOR_SYSTEM, JSON.stringify(input));
  const llmReason = json?.reason ? String(json.reason) : "";
  const gate = deterministicRiskGate(engine, proposal);
  const veto = hard.length > 0 || gate.veto;

  let verdict: "approved" | "vetoed";
  let reason: string;

  if (veto) {
    verdict = "vetoed";
    const triggers =
      hard.length > 0
        ? "HARD RULE: " + hard.join("; ")
        : "RISK GATE: " + gate.reasons.join("; ");
    reason = triggers + (llmReason ? ` | auditor adds: ${llmReason}` : "");
  } else {
    verdict = "approved";
    auditLines.push(gate.reasons.length ? gate.reasons.join("; ") : "no whipsaw / spike state ✓");
    reason =
      "approved — audited: " +
      auditLines.join(" · ") +
      (llmReason ? ` | auditor notes: ${llmReason}` : "");
  }

  const checks = [
    ...hard.map((h) => "violation: " + h),
    ...auditLines,
    ...(Array.isArray(json?.checks) ? json.checks.map(String) : [])
  ];

  return { verdict, reason, checks, hardViolations: hard };
}
