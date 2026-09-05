import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Deployed } from "./types.js";

export type Conviction = "moderate" | "high";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface Config {
  deployed: Deployed;
  dataDir: string;
  rpcUrls: string[];
  agentPrivateKey: string;
  marketMakerPrivateKey: string;
  llm: LlmConfig;
  cycleMs: number;
  vetoWindowCycles: number;
  outcomeHorizonCycles: number;
  port: number;
  marketMakerEnabled: boolean;
  maxSizePct: number;
  minSignalAbs: number;
  conviction: Conviction;
  explorerUrl: string;
  inspectRpcUrls: string[];
  inspectChainLabel: string;
}

export function loadConfig(dataDir?: string): Config {
  const resolvedDataDir =
    dataDir ||
    process.env.DATA_DIR ||
    path.resolve(process.cwd(), "../../.data");
  const deployedPath = path.join(resolvedDataDir, "deployed.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error(
      `deployed.json not found at ${deployedPath}. Run the deploy script first.`
    );
  }
  const deployed = JSON.parse(
    fs.readFileSync(deployedPath, "utf8")
  ) as Deployed;

  return {
    deployed,
    dataDir: resolvedDataDir,
    rpcUrls: splitRpcUrls(process.env.RPC_URL, BASE_SEPOLIA_RPCS),
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY || "",
    marketMakerPrivateKey:
      process.env.MARKET_MAKER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || "",
    llm: {
      baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "deepseek-chat",
      enabled: Boolean(process.env.LLM_API_KEY)
    },
    cycleMs: Number(process.env.CYCLE_MS || 15000),
    vetoWindowCycles: Number(process.env.VETO_WINDOW_CYCLES || 3),
    outcomeHorizonCycles: Number(process.env.OUTCOME_HORIZON_CYCLES || 5),
    port: Number(process.env.PORT || 8787),
    marketMakerEnabled: process.env.MARKET_MAKER !== "off",
    maxSizePct: Number(process.env.MAX_SIZE_PCT || 20),
    minSignalAbs: Number(process.env.MIN_SIGNAL_ABS || 0.25),
    conviction:
      String(process.env.CONVICTION || "moderate") === "high"
        ? "high"
        : "moderate",
    explorerUrl:
      process.env.EXPLORER_URL || "https://sepolia.basescan.org",
    inspectRpcUrls: splitRpcUrls(process.env.MAINNET_RPC_URL, BASE_MAINNET_RPCS),
    inspectChainLabel: "Base mainnet"
  };
}

/** Known-reliable RPCs — sepolia.base.org alone is flaky (occasional TLS
 * failures, so we fall back across providers). */
const BASE_SEPOLIA_RPCS = [
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com",
  "https://base-sepolia.drpc.org"
];

/** Public Base mainnet RPCs that tolerate datacenter (Render) egress — many
 * nodes block cloud IPs. */
const BASE_MAINNET_RPCS = [
  "https://base.llamarpc.com",
  "https://1rpc.io/base",
  "https://base.blockpi.network/v1/rpc/public",
  "https://rpc.ankr.com/eth_base",
  "https://base-rpc.publicnode.com"
];

function splitRpcUrls(
  raw: string | undefined,
  fallback: string[]
): string[] {
  const urls = (raw ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length ? urls : fallback;
}
