"use client";

import { fmtPrice, fmtWei } from "@/lib/format";
import type { AppState } from "@/lib/types";

export default function EnginePanel({ state }: { state: AppState }) {
  const e = state.engine;
  if (!e) {
    return (
      <div className="panel">
        <h3>Numbers</h3>
        <div className="small muted">waiting for the first reading…</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Numbers — written by the engine, not the AI</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={`badge ${e.grade}`}>{e.grade}</span>
        <span className="small muted">
          combined signal {e.score.toFixed(2)} · expected{" "}
          {e.expectedBps >= 0 ? "+" : ""}
          {e.expectedBps} bps move
        </span>
      </div>
      <div className="vstack">
        {e.signals.map((s) => {
          const pct = Math.max(0, Math.min(100, Math.abs(s.value) * 100));
          return (
            <div key={s.key} className="enginebar">
              <span className="name muted mono">{s.key}</span>
              <div className="track">
                <div
                  className="fill"
                  style={{
                    width: `${pct}%`,
                    background: s.value >= 0 ? "#4be0a3" : "#ff6b7a",
                    left: s.value >= 0 ? "50%" : `${50 - pct}%`
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "#2b3547"
                  }}
                />
              </div>
              <span className="small muted mono" style={{ width: 46, textAlign: "right" }}>
                {s.value >= 0 ? "+" : ""}
                {s.value.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <hr className="rule" />
      <div className="grid2">
        <div>
          <div className="small muted">AI&apos;s money</div>
          <div className="small mono">AUTH {fmtWei(state.treasury?.auth ?? "0")}</div>
          <div className="small mono">AUDS {fmtWei(state.treasury?.auds ?? "0")}</div>
        </div>
        <div>
          <div className="small muted">market pool</div>
          <div className="small mono">AUTH {fmtWei(state.reserves?.auth ?? "0")}</div>
          <div className="small mono">AUDS {fmtWei(state.reserves?.auds ?? "0")}</div>
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        price {fmtPrice(e.price)}
        {state.priceChangeBps !== null && state.priceChangeBps !== undefined
          ? ` · ${state.priceChangeBps >= 0 ? "+" : ""}${state.priceChangeBps.toFixed(1)} bps this heartbeat`
          : ""}
      </div>
    </div>
  );
}