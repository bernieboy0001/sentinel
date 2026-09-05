"use client";

import { fmtWei } from "@/lib/format";
import type { AppState } from "@/lib/types";

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

function EquitySpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 240;
  const h = 40;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Equity curve"
      style={{ display: "block", marginTop: 10 }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "#4be0a3" : "#ff6b7a"}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function VaultPanel({ state }: { state: AppState }) {
  const { treasury, valueHistory } = state;
  const points = valueHistory.map((p) => p.value);
  const baseline = points.length ? points[0] : null;
  const current = points.length ? points[points.length - 1] : null;
  const net =
    baseline != null && current != null ? current - baseline : null;
  const pct =
    baseline && net != null && baseline !== 0 ? (net / baseline) * 100 : null;
  const up = net == null || net >= 0;

  return (
    <div className="panel">
      <h3>The AI&apos;s vault — what it&apos;s spending</h3>
      <div className="vault">
        <div className="vaultrow">
          <span>
            <span className="vaultsym">AUTH</span>
            <span className="small muted">the asset it trades</span>
          </span>
          <b className="mono">{treasury ? fmtWei(treasury.auth) : "—"}</b>
        </div>
        <div className="vaultrow">
          <span>
            <span className="vaultsym">AUDS</span>
            <span className="small muted">the stable it buys with</span>
          </span>
          <b className="mono">{treasury ? fmtWei(treasury.auds) : "—"}</b>
        </div>
      </div>

      {baseline != null && current != null && (
        <div
          className="vaultrow"
          style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}
        >
          <span>
            <span className="vaultsym">NET P&amp;L</span>
            <span className="small muted">treasury in AUDS terms</span>
          </span>
          <b className={`mono ${up ? "green" : "red"}`}>
            {up ? "+" : ""}
            {compact(net!)} ({up ? "+" : ""}
            {pct!.toFixed(1)}%)
          </b>
        </div>
      )}
      {points.length >= 2 && <EquitySpark values={points} />}
      <div className="small muted" style={{ marginTop: 8 }}>
        Demo tokens on Base testnet · balances read live from the chain every
        heartbeat, and every vault change is traceable to a row in the
        append-only ledger.
      </div>
    </div>
  );
}