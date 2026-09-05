"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import PowerUp from "@/components/PowerUp";
import TrustGauge from "@/components/TrustGauge";
import PriceChart, { Pt } from "@/components/PriceChart";
import ProposalCard from "@/components/ProposalCard";
import LedgerFeed from "@/components/LedgerFeed";
import OutcomeList from "@/components/OutcomeList";
import EnginePanel from "@/components/EnginePanel";
import InspectPanel from "@/components/InspectPanel";
import VaultPanel from "@/components/VaultPanel";
import { fetchState } from "@/lib/api";
import { fmtPrice } from "@/lib/format";
import type { AppState } from "@/lib/types";

function statusSentence(state: AppState | null): string {
  const p = state?.pending;
  const last = state?.lastDecision;

  if (p && p.side !== "hold") {
    if (p.side === "buy")
      return `The AI thinks AUTH is about to rise. It wants to spend ${p.sizePct}% of its money at ${fmtPrice(p.entryPrice)} — and it is waiting for your answer.`;
    return `The AI thinks AUTH is about to fall. It wants to sell ${p.sizePct}% of what it holds at ${fmtPrice(p.entryPrice)} — and it is waiting for your answer.`;
  }
  if (last && last.side !== "hold") {
    const acted =
      last.side === "buy" ? "bought AUTH" : `sold some AUTH`;
    return `A moment ago it ${acted} at ${fmtPrice(last.entryPrice)} (${
      last.verdict === "approved" ? "the move was allowed" : "it was blocked"
    }). Right now it is quietly reading the market.`;
  }
  if (last) {
    return "Right now it is watching the market, waiting for a signal worth acting on.";
  }
  return "Turning on. The AI is connecting to its on-chain market for the first time.";
}

function HowItWorks() {
  const steps = [
    ["1 · Decide", "The AI reads the market with fixed math — a model never writes a number."],
    ["2 · Announce", "Before touching money, it stamps its plan into a public, permanent record."],
    ["3 · Your veto", "You get a window to press STOP. Stopping it is also recorded forever."],
    ["4 · Re-judge", "Later, the plan is re-scored against reality. That honesty is its trust score."]
  ];
  return (
    <div className="panel">
      <h3>How this works, in 10 seconds</h3>
      <div className="vstack">
        {steps.map(([t, d]) => (
          <div key={t} className="row" style={{ alignItems: "flex-start" }}>
            <span className="badge buy" style={{ flex: "0 0 auto" }}>{t}</span>
            <span className="small muted">{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [everOnline, setEverOnline] = useState(false);
  const [points, setPoints] = useState<Pt[]>([]);
  const lastCycle = useRef<number>(-1);

  const poll = useCallback(async () => {
    try {
      const s = await fetchState();
      setState(s);
      setConnected(true);
      setEverOnline(true);
      setConnError(null);
      setLastSeen(s.ts);
      if (s.cycle !== lastCycle.current && s.price !== null) {
        lastCycle.current = s.cycle;
        setPoints((prev) => {
          const next = [...prev, { cycle: s.cycle, price: s.price as number }];
          return next.slice(-200);
        });
      }
    } catch (e) {
      setConnected(false);
      setConnError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const online = connected && lastSeen && Date.now() - lastSeen < 10000;
  const pending = state?.pending;
  const price = state?.price;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BrandMark size={24} />
            <span className="brandlogo">SENTINEL<em>·</em></span>
          </span>
          <span className="brandsub">a self-auditing autonomous fund · live demo</span>
        </div>
        <div className="topstats">
          <span className={`pill ${online ? "ok" : "bad"}`}>
            <span className={`pulse ${online ? "on" : "off"}`} />
            {online ? "agent online" : "agent offline"}
          </span>
          <span className="pill">
            heartbeat <b>#{state?.cycle ?? "…"}</b>
          </span>
          {state?.conviction && (
            <span className={`pill ${state.conviction === "high" ? "ok" : ""}`}>
              conviction <b>{state.conviction.toUpperCase()}</b>
            </span>
          )}
          <span className="pill">
            AUTH price <b>{price !== null && price !== undefined ? fmtPrice(price) : "…"}</b>
          </span>
          {state?.llm?.enabled ? (
            <span className="pill ok">
              <span className="pulse on" /> AI reasoning live
            </span>
          ) : (
            <span className="pill">
              AI reasoning <b>offline</b>
            </span>
          )}
        </div>
      </header>

      {!everOnline ? (
        <div className="hero boothero">
          <PowerUp />
        </div>
      ) : (
        <div className={`hero ${pending ? "attention" : ""}`}>
          <div className="heromark">◉</div>
          <div style={{ minWidth: 0 }}>
            <div className="hero-kicker">what&apos;s happening right now</div>
            <div className="hero-line">{statusSentence(state)}</div>
            {pending && (
              <div className="hero-hint">
                You are the human override. Press STOP on the decision desk and the
                record of what you stopped stays on-chain — forever.
              </div>
            )}
          </div>
        </div>
      )}

      {everOnline && connError && !online && (
        <div className="conn-error">
          {connError} — Render&apos;s free tier sleeps after ~15 min idle and takes
          ~60 s to wake. This banner clears itself.
        </div>
      )}

      <main className="layout">
        <section>
          {state && (
            <TrustGauge trust={state.trust} tracking={state.tracking ?? { accuracy: 0.5, samples: 0 }} />
          )}
          {state && <VaultPanel state={state} />}
          <HowItWorks />
        </section>

        <section>
          <PriceChart points={points} />
          {state && <OutcomeList outcomes={state.recentOutcomes} />}
          <InspectPanel />
        </section>

        <section>
          {state && <ProposalCard state={state} onReload={poll} />}
          {state && <LedgerFeed entries={state.recentEntries} />}
        </section>
      </main>

      {state && (
        <div className="deep">
          <details>
            <summary>For the curious — the raw numbers, treasury, signals (nothing fake here)</summary>
            <EnginePanel state={state} />
          </details>
        </div>
      )}

      <footer className="footer">
        <div className="footer-row">
          <span className="footer-brand">
            <BrandMark size={20} />
            <b>SENTINEL</b>
          </span>
          <span>
            MEASUREMENTS, NOT ADVICE — nothing here is a recommendation to buy or
            sell anything.
          </span>
          <span className="footer-links mono">
            <a href="https://github.com/bernieboy0001/sentinel" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://sepolia.basescan.org/address/0xC995fCcC57892a5b87dA36c258Fb1c6fC3339DDE" target="_blank" rel="noreferrer">On-chain registry</a>
            <a href="https://audit-agent-b1sx.onrender.com/state" target="_blank" rel="noreferrer">Raw feed</a>
          </span>
        </div>
        <div className="footer-sub mono">
          The black box recorder for AI agents · built for the Telegraph Hackathon.
        </div>
      </footer>
    </>
  );
}