"use client";

import { txLink } from "@/lib/api";
import { shortHash, timeAgo } from "@/lib/format";
import type { LedgerEntry, LedgerKind } from "@/lib/types";

const KIND_META: Record<
  LedgerKind,
  { label: string; cls: string; summary: (e: LedgerEntry) => string }
> = {
  genesis: {
    label: "created",
    cls: "muted",
    summary: () => "treasury started with demo money"
  },
  proposal: {
    label: "the AI said it would act",
    cls: "buy",
    summary: (e) => {
      const d = e.data as any;
      return `${String(d.side).toUpperCase()} ${d.sizePct}% of treasury -> ${d.verdict === "vetoed" ? "blocked by risk check" : "allowed"}`;
    }
  },
  review: {
    label: "risk check",
    cls: "warn",
    summary: (e) => {
      const d = e.data as any;
      return String(d.verdict === "vetoed" ? "blocked the move" : "no problem found");
    }
  },
  execution: {
    label: "trade executed",
    cls: "approved",
    summary: () => "the trade went through, on-chain"
  },
  hold: {
    label: "stood down",
    cls: "hold",
    summary: () => "decided to do nothing"
  },
  outcome: {
    label: "result graded",
    cls: "approved",
    summary: (e) => {
      const d = e.data as any;
      return d.vetoCorrect !== undefined
        ? d.vetoCorrect
          ? "the veto saved money"
          : "the veto was a mistake"
        : d.hit
        ? "the AI was right"
        : "the AI was wrong";
    }
  },
  human_veto: {
    label: "human pressed STOP",
    cls: "vetoed",
    summary: () => "a real person overrode the AI"
  },
  risk_violation: {
    label: "execution problem",
    cls: "vetoed",
    summary: (e) => String((e.data as any).error ?? "a trade failed to execute")
  },
  narration: {
    label: "the AI explained itself",
    cls: "hold",
    summary: () => "wrote a human-readable note about what it did"
  },
  commit: {
    label: "promise recorded on-chain",
    cls: "buy",
    summary: (e) => `intent hashed -> public registry row #${(e.data as any).chainEntry}`
  },
  inspection: {
    label: "audited on request",
    cls: "buy",
    summary: (e) => {
      const d = e.data as any;
      const sym = String(d.symbol ?? "address");
      const inMarket = d.inMarket ? ` — ${d.inMarket} is SENTINEL's market token` : "";
      return `a human asked SENTINEL to audit ${sym}${inMarket}`;
    }
  }
};

export default function LedgerFeed({ entries }: { entries: LedgerEntry[] }) {
  return (
    <div className="panel">
      <h3>The black box — every step, kept forever</h3>
      <p className="sub">
        Nothing can be edited or deleted. Transactions that touch the chain link
        straight to their public record.
      </p>
      <div className="scroll">
        {entries.slice().reverse().map((e) => {
          const meta = KIND_META[e.kind] ?? {
            label: e.kind,
            cls: "muted",
            summary: () => ""
          };
          const hasOnChain = e.txHash || e.kind === "execution";
          return (
            <div key={e.hash} className="entry">
              <div className="row">
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
                <span className="small muted" style={{ marginLeft: "auto" }}>
                  {timeAgo(e.ts)}
                </span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                {meta.summary(e)}
              </div>
              {(hasOnChain || e.chainEntry !== undefined) && (
                <div className="small muted mono" style={{ marginTop: 3 }}>
                  {e.txHash ? (
                    <a href={txLink(e.txHash)} target="_blank" rel="noreferrer">
                      {shortHash(e.txHash, 10)} ↗
                    </a>
                  ) : (
                    <span>{shortHash(e.hash, 8)}</span>
                  )}
                  {e.chainEntry !== undefined && (
                    <span className="muted"> · on-chain row #{e.chainEntry}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="legend">
        <b>On-chain row #</b> = the AI&apos;s public, permanent record — anyone in the
        world can read it. This is the part that can&apos;t be faked.
      </div>
    </div>
  );
}