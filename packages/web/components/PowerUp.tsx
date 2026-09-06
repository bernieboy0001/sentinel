"use client";

import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";

const STEPS = [
  "connecting to chain…",
  "loading the public ledger…",
  "waking the risk auditor…",
  "replaying trust history…",
  "engine warm — market feed online"
];

const BOOT_S = 60;

export default function PowerUp({ note }: { note?: string | null }) {
  const [sec, setSec] = useState(BOOT_S);
  useEffect(() => {
    const id = setInterval(
      () => setSec((s) => (s <= 1 ? BOOT_S : s - 1)),
      1000
    );
    return () => clearInterval(id);
  }, []);

  const elapsed = BOOT_S - sec;
  const progress = Math.min(100, (elapsed / BOOT_S) * 100);
  const stepIdx = Math.min(
    STEPS.length - 1,
    Math.floor((elapsed / BOOT_S) * STEPS.length)
  );

  return (
    <div className="powerup fade-in" role="status" aria-live="polite">
      <div className="powerup-head">
        <BrandMark size={44} />
        <div>
          <div className="powerup-title">SENTINEL — engine power-up</div>
          <div className="powerup-sub">
            full power in ≈ {sec}s · <span className="muted">the engine is a real live process</span>
          </div>
        </div>
      </div>
      <div className="powerup-bar">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="powerup-steps mono">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={i < stepIdx ? "done" : i === stepIdx ? "active" : "todo"}
          >
            {i < stepIdx ? "✓ " : i === stepIdx ? "▸ " : "· "}
            {s}
          </div>
        ))}
      </div>
      <div className="powerup-note">
        {note ? (
          <span className="powerup-error">
            fetch failing: {note} — retrying.
          </span>
        ) : (
          <>
            Nothing here is pre-recorded. The agent sleeps on the free tier and
            needs a moment to reconnect — you&apos;re about to watch the real
            thing, live.
          </>
        )}
      </div>
    </div>
  );
}