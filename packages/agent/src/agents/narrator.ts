import { Config } from "../config.js";
import { llmText } from "../llm.js";
import { DecisionView, ExecutionView, OutcomeView } from "../types.js";

/**
 * The Narrator writes prose. It never computes a number itself —
 * every figure it quotes was produced by the engine first.
 */

export async function narrateDecision(
  config: Config,
  decision: DecisionView,
  auditorReason: string
): Promise<string> {
  const system =
    "You are the NARRATOR of SENTINEL, an autonomous fund. Write a short, honest paragraph " +
    "about the decision just made. Quote only the supplied figures. No financial advice.";
  const user = JSON.stringify({ decision, auditorReason });
  const text = await llmText(config.llm, system, user);
  if (text) return text.trim();
  return `The trader proposed ${decision.side} of ${decision.sizePct}% of the treasury at price ${decision.entryPrice.toFixed(6)} (AUDS/AUTH), expecting ${decision.expectedBps} bps. The auditor ${decision.verdict}.`;
}

export async function narrateExecution(
  config: Config,
  execution: ExecutionView
): Promise<string> {
  const system =
    "You are the NARRATOR of SENTINEL. One paragraph about the trade that just executed on-chain. " +
    "Quote only supplied figures. No financial advice.";
  const text = await llmText(config.llm, system, JSON.stringify(execution));
  if (text) return text.trim();
  return `Executed on-chain: paid ${execution.paid} wei ${execution.paidToken}, received ${execution.received} wei ${execution.receivedToken}. Tx ${execution.txHash.slice(0, 10)}…`;
}

export async function narrateOutcome(
  config: Config,
  outcome: OutcomeView
): Promise<string> {
  const system =
    "You are the NARRATOR of SENTINEL. One honest paragraph about how a past decision turned out. " +
    "Quote only supplied figures. If it lost, say so plainly. No financial advice.";
  const text = await llmText(config.llm, system, JSON.stringify(outcome));
  if (text) return text.trim();
  return `Decision resolved: ${outcome.hit ? "hit" : "miss"} — realized ${outcome.realizedBps.toFixed(0)} bps vs ${outcome.expectedBps} bps expected. ${outcome.note}.`;
}
