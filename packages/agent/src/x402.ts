import { ethers } from "ethers";

/**
 * x402 "offer-receipt" extension (coinbase/x402, extension-offer-and-receipt.md).
 * Dependency-light: only ethers, matching the rest of this package.
 *
 * The agent presents a *signed offer* committing to payment terms in USDC on
 * Base Sepolia (payTo = the agent wallet). Once a client pays via the `exact`
 * scheme (EIP-3009 TransferWithAuthorization), we verify the on-chain
 * settlement, serve the resource, and return a *signed receipt* — the
 * verifiable commerce slip that fits the project's whole audit thesis.
 *
 * All EIP-712 signatures use domain chainId = 1 (per spec §3.2, this is an
 * off-chain signing format; the payment network lives in the payload).
 */

export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const NETWORK = "eip155:84532"; // Base Sepolia, CAIP-2

const OFFER_TYPES = {
  Offer: [
    { name: "version", type: "uint256" },
    { name: "resourceUrl", type: "string" },
    { name: "scheme", type: "string" },
    { name: "network", type: "string" },
    { name: "asset", type: "string" },
    { name: "payTo", type: "string" },
    { name: "amount", type: "string" },
    { name: "validUntil", type: "uint256" }
  ]
};

const RECEIPT_TYPES = {
  Receipt: [
    { name: "version", type: "uint256" },
    { name: "network", type: "string" },
    { name: "resourceUrl", type: "string" },
    { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "transaction", type: "string" }
  ]
};

const OFFER_DOMAIN = { name: "x402 offer", version: "1", chainId: 1 };
const RECEIPT_DOMAIN = { name: "x402 receipt", version: "1", chainId: 1 };

export interface OfferPayload {
  version: number;
  resourceUrl: string;
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  validUntil: number;
}

export interface SignedOffer {
  format: "eip712";
  acceptIndex: number;
  payload: OfferPayload;
  signature: string;
}

export interface ReceiptPayload {
  version: number;
  network: string;
  resourceUrl: string;
  payer: string;
  issuedAt: number;
  transaction: string;
}

export interface SignedReceipt {
  format: "eip712";
  payload: ReceiptPayload;
  signature: string;
}

export interface PaymentRequirements {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { name: string; version: string };
  }[];
  extensions: {
    "offer-receipt": {
      info: { offers: SignedOffer[] };
      schema: Record<string, unknown>;
    };
  };
}

const OFFER_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    offers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", const: "eip712" },
          acceptIndex: { type: "integer" },
          payload: {
            type: "object",
            properties: {
              version: { type: "integer" },
              resourceUrl: { type: "string" },
              scheme: { type: "string" },
              network: { type: "string" },
              asset: { type: "string" },
              payTo: { type: "string" },
              amount: { type: "string" },
              validUntil: { type: "integer" }
            },
            required: [
              "version",
              "resourceUrl",
              "scheme",
              "network",
              "asset",
              "payTo",
              "amount"
            ]
          },
          signature: { type: "string" }
        },
        required: ["format", "payload", "signature"]
      }
    }
  },
  required: ["offers"]
};

export interface OfferOptions {
  resourceUrl: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  validUntil: number;
}

/**
 * Build a signed offer committing us to the given payment terms, valid until
 * `validUntil` (unix seconds). `payTo` is the agent wallet; we sign with it
 * (spec §4.5.1: simplest signer-auth = payTo address signing).
 */
export async function signOffer(
  signer: ethers.Signer,
  opts: OfferOptions
): Promise<SignedOffer> {
  const payload: OfferPayload = {
    version: 1,
    resourceUrl: opts.resourceUrl,
    scheme: "exact",
    network: opts.network,
    asset: opts.asset,
    payTo: opts.payTo,
    amount: opts.amount,
    validUntil: opts.validUntil
  };
  const signature = await signer.signTypedData(OFFER_DOMAIN, OFFER_TYPES, payload);
  return { format: "eip712", acceptIndex: 0, payload, signature };
}

export interface PaymentOptions {
  signer: ethers.Signer;
  resourceUrl: string;
  description: string;
  mimeType: string;
  payTo: string;
  amount: string;
  validUntil: number;
  asset?: string;
  maxTimeoutSeconds?: number;
}

/**
 * Build payment requirements for a paid resource, with a signed offer.
 */
export async function buildPaymentRequirements(
  opts: PaymentOptions
): Promise<PaymentRequirements> {
  const asset = opts.asset ?? USDC_BASE_SEPOLIA;
  const offer = await signOffer(opts.signer, {
    resourceUrl: opts.resourceUrl,
    network: NETWORK,
    asset,
    payTo: opts.payTo,
    amount: opts.amount,
    validUntil: opts.validUntil
  });
  return {
    x402Version: 2,
    resource: {
      url: opts.resourceUrl,
      description: opts.description,
      mimeType: opts.mimeType
    },
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        amount: opts.amount,
        asset,
        payTo: opts.payTo,
        maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 120,
        extra: { name: "USDC", version: "2" }
      }
    ],
    extensions: {
      "offer-receipt": { info: { offers: [offer] }, schema: OFFER_SCHEMA }
    }
  };
}

/**
 * The agent, acting as x402 facilitator, submits the payer's signed EIP-3009
 * TransferWithAuthorization on-chain (the payer pays no gas). The nonce is
 * fetched fresh from the chain each call and the tx is broadcast explicitly —
 * we must NOT let a NonceManager-style wallet inject a cached nonce here
 * (stale caches drift after restarted/parallel sends). Falls back across RPCs.
 */
export async function submitEip3009(
  signer: ethers.Signer,
  provider: ethers.Provider,
  opts: {
    asset: string;
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
    signature: string;
  }
): Promise<ethers.TransactionResponse> {
  const usdc = new ethers.Contract(
    opts.asset,
    [
      "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) returns (bool)"
    ],
    provider
  );
  const sig = ethers.Signature.from(opts.signature);
  const tx = await usdc.transferWithAuthorization.populateTransaction(
    opts.from,
    opts.to,
    opts.value,
    opts.validAfter,
    opts.validBefore,
    opts.nonce,
    sig.v,
    sig.r,
    sig.s
  );
  tx.nonce = await provider.getTransactionCount(await signer.getAddress(), "pending");
  tx.type = 0; // legacy — universally accepted (some public nodes reject 1559)
  const feeData = await provider.getFeeData();
  tx.gasPrice = feeData.gasPrice ?? ethers.parseUnits("0.006", "gwei");
  tx.gasLimit = await provider.estimateGas(tx);
  const signed = await signer.signTransaction(tx);
  return provider.broadcastTransaction(signed);
}

/**
 * Verify an on-chain EIP-3009 settlement. Confirms a USDC transfer of exactly
 * `amount` from `payer` to `payTo` landed on Base Sepolia, and returns its
 * confirmed transaction hash (or throws after `maxTrySeconds`).
 */
export async function verifySettlement(
  provider: ethers.Provider,
  opts: {
    payer: string;
    payTo: string;
    amount: string;
    asset: string;
    maxTrySeconds?: number;
  }
): Promise<{ txHash: string; amount: bigint; to: string; from: string }> {
  const usdc = new ethers.Contract(
    opts.asset,
    ["event Transfer(address indexed from, address indexed to, uint256 value)"],
    provider
  );
  const amount = BigInt(opts.amount);
  const from = ethers.getAddress(opts.payer);
  const to = ethers.getAddress(opts.payTo);
  const maxSec = opts.maxTrySeconds ?? 120;
  const filter = usdc.filters.Transfer(from, to);

  const scan = async (): Promise<
    { txHash: string; amount: bigint; to: string; from: string } | undefined
  > => {
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 500);
    const events = await usdc.queryFilter(filter, fromBlock, latest);
    for (const ev of events) {
      if (!("args" in ev)) continue;
      const [, , value] = ev.args as unknown as [string, string, bigint];
      if (value !== amount) continue;
      const receipt = await provider.getTransactionReceipt(ev.transactionHash);
      if (receipt && receipt.status === 1) {
        return { txHash: ev.transactionHash, amount, to, from };
      }
    }
    return undefined;
  };

  const deadline = Date.now() + maxSec * 1000;
  let rpcFailures = 0;
  for (;;) {
    try {
      const hit = await scan();
      rpcFailures = 0;
      if (hit) return hit;
    } catch {
      if (++rpcFailures > 8) throw new Error("settlement check: RPC unreachable");
      // transient RPC hiccup (sepolia.base.org) — keep polling until deadline
    }
    if (Date.now() > deadline) {
      throw new Error(
        `no USDC settlement of ${opts.amount} to ${opts.payTo} within ${maxSec}s`
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export interface ReceiptOptions {
  payer: string;
  resourceUrl: string;
  issuedAt: number;
  transaction?: string;
}

/**
 * Sign an x402 receipt (EIP-712, domain "x402 receipt", chainId 1) confirming
 * payment received + service delivered. Optionally carries the tx hash for
 * verifiability (spec §5.2).
 */
export async function signReceipt(
  signer: ethers.Signer,
  opts: ReceiptOptions
): Promise<SignedReceipt> {
  const payload: ReceiptPayload = {
    version: 1,
    network: NETWORK,
    resourceUrl: opts.resourceUrl,
    payer: opts.payer,
    issuedAt: opts.issuedAt,
    transaction: opts.transaction ?? ""
  };
  const signature = await signer.signTypedData(RECEIPT_DOMAIN, RECEIPT_TYPES, payload);
  return { format: "eip712", payload, signature };
}

/** Recover the address that signed a receipt (self-contained verification). */
export async function verifyReceiptSignature(
  receipt: SignedReceipt
): Promise<string> {
  return ethers.verifyTypedData(
    RECEIPT_DOMAIN,
    RECEIPT_TYPES,
    receipt.payload,
    receipt.signature
  );
}
