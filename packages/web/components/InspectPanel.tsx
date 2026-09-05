"use client";

import { useState } from "react";
import { inspectTarget } from "@/lib/api";
import { inspectMainnet } from "@/lib/chainInspect";
import { fmtPrice, shortAddr } from "@/lib/format";
import type { InspectionResult } from "@/lib/types";

const CHIPS: { label: string; addr: string; net: "agent" | "mainnet" }[] = [
  { label: "AUTH (SENTINEL's token)", addr: "0x21D3C381eb5c1Da6cc971F5EA5097d55a8C2Be6c", net: "agent" },
  { label: "AI's wallet", addr: "0x0213E0E289Cee20eFC1B851dd48F1C6F06F79Ac2", net: "agent" },
  { label: "USDC · mainnet", addr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", net: "mainnet" },
  { label: "WETH · mainnet", addr: "0x4200000000000000000000000000000000000006", net: "mainnet" }
];

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
      <span className="small muted">{k}</span>
      <span className="small mono" style={{ textAlign: "right", wordBreak: "break-all" }}>
        {v}
      </span>
    </div>
  );
}

export default function InspectPanel() {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (addr: string, net: "agent" | "mainnet") => {
    if (!addr.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let r: InspectionResult | null = null;
      if (net === "mainnet") {
        r = await inspectMainnet(addr.trim());
      } else {
        const res = await inspectTarget(addr.trim());
        r = res.ok ? res.data : null;
      }
      if (r) {
        setResult(r);
      } else {
        setError("couldn't audit that through the agent — is it online?");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="panel">
      <h3>Audit anything — give SENTINEL an address</h3>
      <p className="sub">
        Paste any address on Base mainnet or the testnet. It reads the truth
        straight from the contract — and it will not invent a price it can&apos;t
        verify.
      </p>

      <div className="inspectbar">
        <input
          className="term-input mono"
          placeholder="0x… contract or wallet address"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(target, target.startsWith("0x21D3") || target === CHIPS[1].addr ? ("agent" as const) : ("mainnet" as const))}
          aria-label="address to audit"
          spellCheck={false}
        />
        <button
          className="term-button mono"
          onClick={() => run(target, target.startsWith("0x21D3") || target === CHIPS[1].addr ? ("agent" as const) : ("mainnet" as const))}
          disabled={busy || !target.trim()}
        >
          {busy ? "reading chain…" : "audit →"}
        </button>
      </div>

      <div className="row" style={{ margin: "8px 0 12px" }}>
        <span className="small muted">try:</span>
        {CHIPS.map((c) => (
          <button key={c.addr} className="chip mono" onClick={() => { setTarget(c.addr); run(c.addr, c.net); }}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="result red small">{error}</div>}

      {result && (
        <div className="inspect-result">
          <Row k="address" v={shortAddr(result.target)} />
          <Row k="read on" v={result.chain} />
          <Row k="type" v={result.isContract ? "smart contract" : "wallet"} />
          {result.inMarket && (
            <>
              <Row k="in SENTINEL's market" v={<b className="green">{result.inMarket}</b>} />
              <Row k="live AMM price" v={fmtPrice(result.price ?? 0)} />
            </>
          )}
          {result.symbol && result.symbol !== "—" && (
            <>
              <Row k="token" v={`${result.name ? result.name + " " : ""}(${result.symbol})`} />
              <Row k="decimals" v={result.decimals ?? "—"} />
            </>
          )}
          {result.eth !== undefined && <Row k="ETH held" v={`${result.eth} ETH`} />}
          {result.agentBalance !== undefined && (
            <Row
              k="SENTINEL's balance of it"
              v={result.agentBalance}
            />
          )}
          <div className="small" style={{ marginTop: 10 }}>{result.note}</div>
        </div>
      )}

      {!result && !error && (
        <div className="small muted">
          Hint: hit the chips above (testnet + mainnet tokens), or paste any
          address — the record of this audit is appended to the black box.
        </div>
      )}
    </div>
  );
}