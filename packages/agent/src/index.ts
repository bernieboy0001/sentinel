import { loadConfig } from "./config.js";
import { connectChain } from "./chain.js";
import { Store } from "./store.js";
import { startMarketMaker } from "./marketMaker.js";
import { startLoop } from "./loop.js";
import { startServer } from "./server.js";

function banner(config: ReturnType<typeof loadConfig>): void {
  console.log("----------------------------------------");
  console.log("  SENTINEL — self-auditing autonomous fund");
  console.log("----------------------------------------");
  console.log("network :", config.deployed.network, "chainId", config.deployed.chainId);
  console.log("agent   :", config.deployed.agent);
  console.log("amm     :", config.deployed.amm);
  console.log("registry:", config.deployed.auditRegistry);
  console.log(
    "llm     :",
    config.llm.enabled ? config.llm.model : "DISABLED (deterministic fallback)"
  );
  console.log("mode    :", config.marketMakerEnabled ? "demo sandbox" : "live");
  console.log("cycle   :", `${config.cycleMs}ms`, "| veto window:", config.vetoWindowCycles, "cycles");
}

async function main(): Promise<void> {
  const config = loadConfig();
  banner(config);

  const chain = connectChain(config);
  const store = new Store(config);
  store.load();

  startMarketMaker(chain, config);
  startLoop(chain, config, store);
  startServer(config, store, chain);

  const shutdown = () => {
    console.log("\n[SENTINEL] shutting down");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // A flaky RPC once threw after the socket closed and took the process down.
  // The health of the demo matters more than one unhappy request: log it, move on.
  process.on("unhandledRejection", (e) =>
    console.warn("[SENTINEL] unhandled rejection:", (e as Error)?.message ?? e)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
