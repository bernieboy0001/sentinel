# SENTINEL — Deployment Guide

Put SENTINEL live in three pieces:

```
 Base Sepolia (testnet)     long-running agent (Render)     dashboard (Vercel)
 contracts + liquidity  ->   does the trading, keeps the     shows it all live,
 deployed once               on-chain ledger, serves /state   lets you VETO
```

Free everything: testnet ETH is free, Render starter + Vercel hobby are free.

---

## 0. One-time prep (5 min)

1. **Put the repo on GitHub** so Vercel and Render can import it:
   ```
   git init
   git add .
   git commit -m "SENTINEL"
   gh repo create sentinel --public --source=. --push
   ```
2. **Create 3 wallets** (or reuse the hardhat dev keys). Only for testnet, any wallet
   generator works. You need three private keys:
   - `deployer` — pays for contract creation
   - `agent` — the trading bot's wallet (treasury holds AUTH/AUDS here)
   - `market maker` — generates live price movement for the demo
3. **Fund all three with Base Sepolia ETH** from a faucet (Bridge from Base mainnet,
   or search "Base Sepolia faucet"). Each needs ~0.05 ETH to cover gas for a few
   approvals. The tokens themselves are free (the deploy script mints them).

---

## 1. Deploy contracts to Base Sepolia (one time)

```powershell
Copy-Item packages\contracts\.env.example packages\contracts\.env
# edit packages/contracts/.env and set:
#   PRIVATE_KEY=<deployer>
#   AGENT_PRIVATE_KEY=<agent>
#   MARKET_MAKER_PRIVATE_KEY=<market maker>
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
npm.cmd run deploy:testnet
```

This mints AUTH + AUDS, seeds the AMM (1,000,000 AUTH / 100,000 AUDS), funds the
agent treasury (2,000 AUTH + 100,000 AUDS) and the market maker, pre-approves the
AMM for both wallets, commits the genesis audit entry, and writes `.data/deployed.json`.

> `.data/deployed.json` holds only **public** addresses — no secrets. The agent
> worker needs a copy of it. Bake it into the repo so deploys pick it up:
>
> ```powershell
> Copy-Item .data\deployed.json packages\agent\deployed.json
> git add packages\agent\deployed.json
> git commit -m "publish testnet deployment"
> git push
> ```

---

## 2. Long-running agent worker (Render)

The agent is an HTTP process that runs forever, trades, writes the on-chain ledger,
and serves the dashboard API on port 8787. `render.yaml` + `packages/agent/Dockerfile`
are ready to go.

1. Render → **New → Blueprint** → pick the `sentinel` repo.
   It auto-detects `render.yaml`, builds the Docker image, mounts a 1 GB disk at
   `/app/.data` (so the ledger survives restarts), and health-checks `/health`.
2. When prompted, fill the secrets:
   - `RPC_URL` = `https://sepolia.base.org`
   - `AGENT_PRIVATE_KEY` = agent wallet
   - `MARKET_MAKER_PRIVATE_KEY` = market maker wallet
   - `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` = optional (see step 4)
3. Wait for the deploy. The service logs will show the banner, market maker, and
   cycle ticks. Copy the service URL, e.g. `https://audit-agent.onrender.com`.
4. Sanity check: open `https://audit-agent.onrender.com/health` → `{"ok":true}`.

> Alternative hosts: **Railway** (same Dockerfile, add a volume mount to `/app/.data`)
> or **Fly.io** (`fly launch` with the same Dockerfile + a volume).

Local smoke test without any deploy:
```powershell
Copy-Item .env.example packages\agent\.env   # set RPC_URL + the two keys
npm.cmd run agent:run
```

---

## 3. Dashboard (Vercel)

1. Vercel → **Add New Project** → import the `sentinel` repo.
2. Set **Root Directory** to `packages/web`.
3. Vercel detects Next.js automatically. Add one env var:
   - `NEXT_PUBLIC_AGENT_URL` = `https://audit-agent.onrender.com` (no trailing slash)
4. **Deploy.** The dashboard is a static client page that polls the agent's `/state`
   endpoint every 2 s (CORS is wide open on the agent for demo purposes).

Local smoke test:
```powershell
Copy-Item packages\web\.env.example packages\web\.env.local
npm.cmd run dev:web
```

---

## 4. Optional: LLM reasoning

Without any LLM key the whole system runs **deterministically** (engine math +
templates) — great for a bulletproof demo. To light up the trader/auditor/narrator
agents, set on the Render service (or in `.env` locally):

- `LLM_API_KEY` = your DeepSeek (or OpenAI-compatible) key
- `LLM_BASE_URL` = `https://api.deepseek.com` (default)
- `LLM_MODEL` = `deepseek-chat` (default)

The model writes **explanations only**. Every number — signal, position size, risk
verdict, trust score — is computed by the engine, and the model is told so.

---

## 5. Verify the whole thing

1. Open the Vercel URL: price chart moves, trust gauge animates, ledger feed fills.
2. During a pending decision, click **VETO THIS TRADE** → the audit trail records
   the veto as on-chain governance evidence (`AuditRegistry` entry, explorer link).
3. Every executed trade shows its BaseScan link. You can also query the registry
   directly:
   ```powershell
   npm.cmd run inspect:testnet   # from packages/contracts: reads the on-chain registry
   ```
   to print `entryCount` + latest commit.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| agent crashes: `deployed.json not found` | run `deploy:testnet` first, then copy it into `packages/agent/deployed.json` and re-deploy |
| `nonce too low` / `expected X got Y` | make sure only **one** agent instance is running; the code already uses a `NonceManager` but two processes share the wallet |
| no price movement | set `MARKET_MAKER` env; default is on; check the MM key was funded |
| dashboard shows "agent offline" | check `NEXT_PUBLIC_AGENT_URL` has no trailing slash and the service `/health` responds |
| out of testnet gas | top up the `agent` wallet; approvals are only needed at deploy time, swaps cost a little each |
