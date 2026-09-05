import { createServer } from "node:http";
import { Config } from "./config.js";
import { Chain } from "./chain.js";
import { Store } from "./store.js";
import { inspectAddress } from "./inspect.js";
import {
  USDC_BASE_SEPOLIA,
  NETWORK,
  buildPaymentRequirements,
  submitEip3009,
  verifySettlement,
  signReceipt
} from "./x402.js";

/** x402 paid resource: the fund's latest audited decision/state. */
const X402_RESOURCE_URL = "/x402/quote";
const X402_DESCRIPTION =
  "The SENTINEL self-auditing fund's latest live decision snapshot, paid in USDC.";
/** Price in micro-USDC: 0.1 USDC for the audited decision + signed receipt. */
const X402_PRICE_MICRO = "100000";
/** Offers stay valid for 2 minutes. */
const X402_VALID_SECONDS = 120;

function send(
  res: import("node:http").ServerResponse,
  code: number,
  body: unknown
): void {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(JSON.stringify(body));
  } catch {
    /* client went away mid-response — nothing to do */
  }
}

export function startServer(config: Config, store: Store, chain: Chain): void {
  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, {
        service: "SENTINEL agent",
        status: "running",
        endpoints: ["/health", "/state", "/ledger", "/human-veto", "/run-cycle", "/inspect", "/reset", "/x402/quote"]
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        cycle: store.cycle,
        llm: config.llm.enabled ? { enabled: true, model: config.llm.model } : { enabled: false }
      });
    }
    if (req.method === "GET" && url.pathname === "/state") {
      return send(res, 200, store.snapshot());
    }
    if (req.method === "GET" && url.pathname === "/ledger") {
      const n = Number(url.searchParams.get("n") ?? 50);
      return send(res, 200, store.ledger.tail(n));
    }
    if (req.method === "POST" && url.pathname === "/human-veto") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { decisionId } = JSON.parse(body || "{}");
          const ok = store.humanVeto(decisionId);
          return send(res, ok ? 200 : 404, { ok, decisionId });
        } catch {
          return send(res, 400, { error: "bad json" });
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run-cycle") {
      store.forceRun = true;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/reset") {
      store.reset();
      return send(res, 200, { ok: true, note: "live report card re-zeroed" });
    }
    if (req.method === "POST" && url.pathname === "/inspect") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        (async () => {
          try {
            const { target } = JSON.parse(body || "{}");
            if (!target || typeof target !== "string") {
              return send(res, 400, { error: "send a target address" });
            }
            const result = await inspectAddress(
              chain,
              target,
              {
                rpcUrls: config.inspectRpcUrls,
                chainLabel: config.inspectChainLabel
              }
            );
            store.recordInspection(result);
            return send(res, 200, result);
          } catch (e) {
            return send(res, 400, {
              error: `couldn't inspect that address: ${(e as Error).message}`
            });
          }
        })();
      });
      return;
    }

    // ---- x402 paid resource: the audited decision, bought in USDC ---------
    if (req.method === "GET" && url.pathname === X402_RESOURCE_URL) {
      // Advertise payment terms with a signed offer (coinbase/x402 offer-receipt).
      (async () => {
        try {
          const now = Math.floor(Date.now() / 1000);
          const requirements = await buildPaymentRequirements({
            signer: chain.agent,
            resourceUrl: X402_RESOURCE_URL,
            description: X402_DESCRIPTION,
            mimeType: "application/json",
            payTo: chain.agent.address,
            amount: X402_PRICE_MICRO,
            validUntil: now + X402_VALID_SECONDS
          });
          return send(res, 402, requirements);
        } catch (e) {
          return send(res, 500, { error: (e as Error).message });
        }
      })();
      return;
    }

    if (req.method === "POST" && url.pathname === X402_RESOURCE_URL) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        (async () => {
          try {
            const payload = JSON.parse(body || "{}");
            const accepted = payload?.accepted;
            const auth = payload?.payload?.authorization;
            const payer = auth?.from;
            if (!accepted || !payer || typeof payer !== "string") {
              return send(res, 400, {
                error: "malformed x402 payment payload",
                hint: "send { x402Version, accepted, payload: { signature, authorization: { from, ... } } }"
              });
            }
            const amount = String(accepted.amount ?? "0");
            const asset = String(accepted.asset ?? "");
            if (asset.toLowerCase() !== USDC_BASE_SEPOLIA.toLowerCase()) {
              return send(res, 400, { error: "unsupported asset (need USDC)" });
            }
            if (
              accepted.scheme !== "exact" ||
              accepted.network !== NETWORK ||
              accepted.payTo?.toLowerCase() !== chain.agent.address.toLowerCase()
            ) {
              return send(res, 400, { error: "payment terms don't match our offer" });
            }

            const payerSig = payload?.payload?.signature;
            if (typeof payerSig !== "string" || !payerSig.startsWith("0x")) {
              return send(res, 400, {
                error: "missing payer EIP-3009 signature",
                hint: "payload.payload.signature must be the client-signed TransferWithAuthorization"
              });
            }

            // The agent is the facilitator: submit the payer's signed EIP-3009
            // TransferWithAuthorization (payer pays no gas). Public RPCs
            // (sepolia.base.org) fail intermittently — retry a few times.
            // A definite revert means the auth can never settle (bad sig,
            // spent nonce, wrong window); anything else we let verifySettlement
            // confirm against the chain (the submit may have landed).
            let failure: unknown;
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const tx = await submitEip3009(chain.agent, chain.provider, {
                  asset,
                  from: payer,
                  to: chain.agent.address,
                  value: amount,
                  validAfter: String(auth?.validAfter ?? 0),
                  validBefore: String(auth?.validBefore ?? 0),
                  nonce: auth?.nonce,
                  signature: payerSig
                });
                await tx.wait();
                console.log(`[x402] settled ${tx.hash} (${payer} paid ${amount} USDC)`);
                failure = undefined;
                break;
              } catch (e) {
                const msg = (e as Error).message ?? "";
                if (/revert/i.test(msg) || /replaced/i.test(msg)) {
                  failure = e;
                  break; // deterministic local failure — don't retry same auth
                }
                failure = e;
                if (attempt === 4) break;
                await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
              }
            }
            if (failure) {
              const msg = (failure as Error).message ?? "";
              console.error(`[x402] settlement submit failed: ${msg.slice(0, 160)}`);
              if (/FiatToken/i.test(msg) || /revert/i.test(msg)) {
                return send(res, 400, {
                  error: "settlement authorization rejected on-chain",
                  detail: msg
                });
              }
              // transient RPC failure — fall through; verifySettlement will
              // check whether it actually landed.
            }

            // New block may not be indexed yet; poll for the confirmed event.
            const settled = await verifySettlement(chain.provider, {
              payer,
              payTo: chain.agent.address,
              amount,
              asset: USDC_BASE_SEPOLIA,
              maxTrySeconds: X402_VALID_SECONDS
            });

            // Payment confirmed — serve the resource + a signed receipt.
            const receipt = await signReceipt(chain.agent, {
              payer,
              resourceUrl: X402_RESOURCE_URL,
              issuedAt: Math.floor(Date.now() / 1000),
              transaction: settled.txHash
            });

            const resource = {
              service: "SENTINEL agent",
              resourceUrl: X402_RESOURCE_URL,
              decision: store.snapshot().lastDecision,
              state: store.snapshot().engine,
              ts: store.snapshot().ts
            };

            return send(res, 200, {
              success: true,
              transaction: settled.txHash,
              network: NETWORK,
              payer,
              resource,
              extensions: {
                "offer-receipt": {
                  info: { receipt },
                  schema: {
                    $schema: "https://json-schema.org/draft/2020-12/schema",
                    type: "object",
                    properties: {
                      receipt: {
                        type: "object",
                        properties: {
                          format: { type: "string", const: "eip712" },
                          payload: {
                            type: "object",
                            properties: {
                              version: { type: "integer" },
                              network: { type: "string" },
                              resourceUrl: { type: "string" },
                              payer: { type: "string" },
                              issuedAt: { type: "integer" },
                              transaction: { type: "string" }
                            },
                            required: [
                              "version",
                              "network",
                              "resourceUrl",
                              "payer",
                              "issuedAt"
                            ]
                          },
                          signature: { type: "string" }
                        },
                        required: ["format", "payload", "signature"]
                      }
                    },
                    required: ["receipt"]
                  }
                }
              }
            });
          } catch (e) {
            return send(res, 400, { error: (e as Error).message });
          }
        })();
      });
      return;
    }

    return send(res, 404, { error: "not found" });
  });

  server.listen(config.port, () =>
    console.log(`[SENTINEL] dashboard API on http://localhost:${config.port}`)
  );
}
