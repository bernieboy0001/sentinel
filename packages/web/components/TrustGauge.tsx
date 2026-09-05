"use client";

import { TrustState } from "@/lib/types";

function classify(score: number): { color: string; word: string } {
  if (score >= 60) return { color: "#4be0a3", word: "trustworthy" };
  if (score >= 40) return { color: "#ffbd68", word: "still earning trust" };
  return { color: "#ff6b7a", word: "unreliable right now" };
}

function GaugeArc({ value, color }: { value: number; color: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`Trust score ${value} out of 100`}>
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="#222a3b"
        strokeWidth="9"
      />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dashoffset 1s ease, stroke 0.5s ease" }}
      />
      <text
        x="60"
        y="58"
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 800 }}
      >
        {value}
      </text>
      <text
        x="60"
        y="80"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#a7b0c6"
        style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 1 }}
      >
        / 100
      </text>
    </svg>
  );
}

export default function TrustGauge({
  trust,
  tracking
}: {
  trust: TrustState;
  tracking: { accuracy: number; samples: number };
}) {
  const score = trust.score;
  const { color, word } = classify(score);
  const goodBusters =
    trust.vetoes > 0 && trust.vetoCorrect > trust.vetoes - trust.vetoCorrect;
  const cold = tracking.samples >= 8 && tracking.accuracy <= 0.45;

  return (
    <div className="panel fade-in">
      <h3>The AI&apos;s report card</h3>
      <p className="sub">
        It grades itself from what actually happened after each decision. The model
        never writes this number — the engine does.
      </p>
      <div className="gaugewrap">
        <GaugeArc value={score} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="statgrid">
            <div className="stat">
              <span className="k">right calls</span>
              <span className="v green">{trust.hits}</span>
            </div>
            <div className="stat">
              <span className="k">wrong calls</span>
              <span className="v red">{trust.misses}</span>
            </div>
            <div className="stat">
              <span className="k">risk-checker stops</span>
              <span className="v">{trust.vetoes}</span>
            </div>
            <div className="stat">
              <span className="k">stop was right</span>
              <span className="v">{trust.vetoCorrect}</span>
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            {trust.resolved} of {trust.totalDecisions} decisions judged so far
            {trust.pending > 0 ? ` · ${trust.pending} still waiting` : ""}
          </div>
        </div>
      </div>
      <div
        className={`tracking-badge ${cold ? "cold" : tracking.accuracy >= 0.5 ? "hot" : ""}`}
      >
        <span className="kick">verified hit-rate</span>
        <span className="mono">
          {tracking.samples > 0 ? `${Math.round(tracking.accuracy * 100)}%` : "—"}
        </span>
        <span className="small muted">
          {tracking.samples === 0
            ? "not enough graded calls yet"
            : `last ${tracking.samples} graded calls · ` +
              (cold
                ? "cold streak → it shrinks size & the gate tightens"
                : tracking.accuracy >= 0.5
                  ? "healthy → it sizes bets from this"
                  : "warming up")}
        </span>
      </div>
      <div className="trust-readout">
        {score > 50 ? "+" : ""}
        {score - 50} vs. the starting point of 50 · {word}
      </div>
      {goodBusters && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Most of the risk-checker&apos;s stops turned out to be the right call.
        </div>
      )}

      {trust.history.length > 0 && (
        <>
          <hr className="rule" />
          <div className="small muted" style={{ marginBottom: 6 }}>
            what moved it, most recent first
          </div>
          <div className="vstack">
            {trust.history.slice(-5).reverse().map((h, i) => (
              <div key={i} className="row small">
                <span
                  className={`mono ${h.delta >= 0 ? "green" : "red"}`}
                  style={{ width: 44, flex: "0 0 auto" }}
                >
                  {h.delta >= 0 ? "+" : ""}
                  {h.delta}
                </span>
                <span className="muted">{h.why}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}