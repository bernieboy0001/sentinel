# SENTINEL — the self-auditing autonomous fund

> An AI agent that trades a **live on-chain market**, commits **every decision
> to a public append-only ledger**, hashes its intent **on-chain before
> executing**, and then **re-scores itself on outcomes** — so you can watch it
> earn or lose your trust in real time, and veto it while it's mid-decision.

Built for the Orion Builder and Telegraph hackathons. Everything runs free on testnet.

**▶ Live now:** <https://audit-agent-eta.vercel.app> (agent worker:
<https://audit-agent-b1sx.onrender.com>). Works on any base address.

---

## Why this exists

Crypto agents have been built. Drift-d reads what attention is ahead of volume.
Rigel reads wallets. AutoHedge runs a four-agent trading fund. What does NOT
exist is a fund that is **accountable**:

- the engine writes every number (never the model),
- the model writes every explanation (never a number),
- every decision is hashed into an **append-only ledger**,
- the intent is **committed on-chain before execution**,
- the agent **measures its own outcomes** and publishes whether it was right,
- the agent **learns**: its verified hit-rate — engine-computed from the
  ledger — sizes every bet. Hot streak → press the edge. Cold streak → shrink
  and hold. You can watch the trade-off happen live.
- optional **high-conviction discipline** (`CONVICTION=high`): the fund refuses
  to trade when momentum doesn't agree in the trade's direction, the signal is
  under a stiff floor, volatility is violent, or its own recent calls on that
  side are a series of misses — and it *throttles* stretched-but-still-trending
  moves instead of skipping them. The declines are recorded with a reason,
  evidence of restraint, not silence.

That is the black-box recorder for AI agents — the trust layer every fund,
DAO, and insurer needs before letting agents touch real money.

## Architecture

```
packages/
  contracts/  Hardhat · MinimalAMM (Uniswap-V2 style), MintableERC20 ×2, AuditRegistry (append-only on-chain)
  agent/      Node/TS worker · signal engine, trader agent, risk auditor, narrator, outcome scorer, market maker, API
  web/        Next.js dashboard · live trust score, price chart, decision desk + VETO, ledger feed
```

```
                         AMM pool (Base Sepolia testnet / local hardhat)
                        ▲ buy/sell swaps ▲             ▲ swap (trends)
                        │                │             │
        ┌───────────────┴──────┐  ┌─────┴──────┐  ┌────┴──────┐
        │  TRADER agent (LLM)   │  │  AUDITOR   │  │ market    │
        │  proposes side+size   │  │ veto (LLM  │  │ maker bot │
        │  from ENGINE signals  │  │ + hard     │  │ (demo)    │
        └───────────┬───────────┘  │ rules)     │  └───────────┘
                    │              └────────────┘
                    ▼
        append-only JSONL ledger  ──hash──▶  AuditRegistry (on-chain)
                    │
              outcome scorer  ──▶  Trust Score (engine-computed)
                    │
                Next.js dashboard │ VETO button → human governance
```

### The accountability loop (one cycle)

1. **Engine** reads pool reserves → computes signals (momentum, mean-reversion,
   volatility) and an expected move in bps. Numbers only.
2. **Trader agent** (LLM) proposes `buy/sell/hold` + size, citing the signals.
3. **Risk auditor** (LLM + deterministic hard rules) approves or vetoes —
   hard rules (size cap, signal floor, exposure cap) veto regardless.
4. If approved & not a hold: the **intent hash is committed on-chain**
   (`decide:<id>`) and a **human veto window** opens on the dashboard.
5. After the window, the **swap executes on-chain** (`exec:<id>` committed too).
6. Later, the **outcome engine** re-scores the decision against realized price
   movement and updates the **Trust Score** (base 50, moves on evidence).
7. The **narrator** writes plain-English explanations — quoting engine figures
   only, admitting losses plainly.

## Quickstart (local, full demo, zero $)

Requires Node 20+, npm. Network flakiness during `npm install` on Windows:
use `--fetch-timeout=600000` if downloads stall.

```bash
npm install
```

### 1. Start a local chain + deploy

```powershell
# terminal A
npx hardhat node            # from packages/contracts
# terminal B
cd packages/contracts
$env:AGENT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$env:MARKET_MAKER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
npm run deploy:local        # writes ../sentinel/.data/deployed.json
```

### 2. Run the agent

```powershell
cd packages/agent
Copy-Item .env.example .env   # default RPC_URL points at sepolia — override for local:
#   RPC_URL=http://127.0.0.1:8545
#   AGENT_PRIVATE_KEY=<the first key above>
#   MARKET_MAKER_PRIVATE_KEY=<the second key above>
#   CYCLE_MS=4000
npm run agent:run
```

Watch the API: `http://localhost:8787/state`

### 3. Run the dashboard

```powershell
cd packages/web
Copy-Item .env.example .env.local
npm run dev                 # http://localhost:3000
# veto the agent live from the "Decision desk"
```

Or run the whole local loop headlessly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/e2e-test.ps1
```

## Base Sepolia (real testnet, still free)

1. Fund two testnet wallets (ETH faucet: `docs.base.org/tools/faucets`).
2. `packages/contracts/.env`:
   ```
   PRIVATE_KEY=<deployer>
   AGENT_PRIVATE_KEY=<agent treasury>
   MARKET_MAKER_PRIVATE_KEY=<market maker>
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   ```
3. `npm run deploy:testnet` from `packages/contracts`.
4. Point the agent's `.env` at the same keys + RPC, keep `MARKET_MAKER=on`.
5. Watch txs confirm on Basescan via the dashboard links.

## Deployment (Vercel + worker)

- **Dashboard → Vercel**: `cd packages/web && vercel`. Set
  `NEXT_PUBLIC_AGENT_URL` to your worker URL.
- **Agent worker → Render/Railway/Fly** (needs persistence): run
  `packages/agent` with `/data` mounted. It serves `/state`, `/ledger`,
  `/human-veto`, `/run-cycle`.
- The browser talks to the worker directly (CORS `*`). For production-grade
  hardening you'd proxy behind the API route — fine for a hackathon.

## Env reference

`packages/agent`:
`RPC_URL`, `AGENT_PRIVATE_KEY`, `MARKET_MAKER_PRIVATE_KEY`, `MARKET_MAKER`,
`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (OpenAI-compatible, optional),
`CYCLE_MS`, `VETO_WINDOW_CYCLES`, `OUTCOME_HORIZON_CYCLES`, `PORT`,
`MAX_SIZE_PCT`, `MIN_SIGNAL_ABS`, `EXPLORER_URL`, `DATA_DIR`, `CONVICTION`
(`moderate` | `high`).

`packages/web`:
`NEXT_PUBLIC_AGENT_URL`, `NEXT_PUBLIC_EXPLORER_URL`.

Without `LLM_API_KEY` the agent runs fully **deterministic** (still great);
with it, trader/auditor/narrator gain real reasoning.

## Testing

```bash
npm run test          # contracts (hardhat) + agent (vitest)
npm run typecheck     # agent + web
```