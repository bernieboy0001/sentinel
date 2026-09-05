import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import {
  USDC_BASE_SEPOLIA,
  NETWORK,
  signOffer,
  signReceipt,
  verifyReceiptSignature,
  buildPaymentRequirements,
  submitEip3009
} from "../src/x402.js";

describe("x402 offer-receipt (EIP-712)", () => {
  const signer = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  );
  const payTo = signer.address;
  const payer = ethers.Wallet.createRandom().address;
  const resourceUrl = "/x402/quote";

  it("builds payment requirements with a signed offer for USDC on Base Sepolia", async () => {
    const req = await buildPaymentRequirements({
      signer,
      resourceUrl,
      description: "audited decision",
      mimeType: "application/json",
      payTo,
      amount: "10000000",
      validUntil: 2000000000
    });
    expect(req.x402Version).toBe(2);
    expect(req.accepts[0].asset.toLowerCase()).toBe(USDC_BASE_SEPOLIA.toLowerCase());
    expect(req.accepts[0].network).toBe(NETWORK);
    expect(req.accepts[0].payTo?.toLowerCase()).toBe(payTo.toLowerCase());
    expect(req.accepts[0].amount).toBe("10000000");
    const offer = req.extensions["offer-receipt"].info.offers[0];
    expect(offer.format).toBe("eip712");
    expect(offer.payload.payTo?.toLowerCase()).toBe(payTo.toLowerCase());
    expect(offer.payload.amount).toBe("10000000");
    // signer == payTo, so the recovered signer must equal payTo (spec §4.5.1)
    const recovered = ethers.verifyTypedData(
      { name: "x402 offer", version: "1", chainId: 1 },
      {
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
      },
      offer.payload,
      offer.signature
    );
    expect(recovered.toLowerCase()).toBe(payTo.toLowerCase());
  });

  it("signs a receipt that verifies back to the agent address", async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const receipt = await signReceipt(signer, {
      payer,
      resourceUrl,
      issuedAt,
      transaction: "0x".padEnd(66, "1")
    });
    expect(receipt.format).toBe("eip712");
    expect(receipt.payload.payer.toLowerCase()).toBe(payer.toLowerCase());
    expect(receipt.payload.network).toBe(NETWORK);
    expect(receipt.payload.resourceUrl).toBe(resourceUrl);
    const recovered = await verifyReceiptSignature(receipt);
    expect(recovered.toLowerCase()).toBe(payTo.toLowerCase());
  });

  it("treats missing optional transaction as empty string (per spec)", async () => {
    const receipt = await signReceipt(signer, {
      payer,
      resourceUrl,
      issuedAt: 1
    });
    expect(receipt.payload.transaction).toBe("");
    const recovered = await verifyReceiptSignature(receipt);
    expect(recovered.toLowerCase()).toBe(payTo.toLowerCase());
  });

  it("submitEip3009 builds and broadcasts a legacy (type 0) payment tx", async () => {
    // Payer signs an EIP-3009 TransferWithAuthorization exactly as a client would.
    const payerWallet = ethers.Wallet.createRandom();
    const value = 100000n;
    const validAfter = 1n;
    const validBefore = 2n;
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const typeData = {
      from: payerWallet.address,
      to: signer.address,
      value,
      validAfter,
      validBefore,
      nonce
    };
    const signature = await payerWallet.signTypedData(
      { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC_BASE_SEPOLIA },
      {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      },
      typeData
    );

    let broadcastRaw = "";
    const provider = {
      getTransactionCount: async () => 7,
      getFeeData: async () => ({
        gasPrice: 101n,
        maxFeePerGas: 201n,
        maxPriorityFeePerGas: 11n
      }),
      estimateGas: async () => 21000n,
      broadcastTransaction: async (signed: string) => {
        broadcastRaw = signed;
        return { hash: "0x".padEnd(66, "7") };
      }
    } as unknown as ethers.Provider;

    const tx = await submitEip3009(signer, provider, {
      asset: USDC_BASE_SEPOLIA,
      from: payerWallet.address,
      to: signer.address,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      signature
    });

    expect(tx.hash).toBe("0x".padEnd(66, "7"));
    const parsed = ethers.Transaction.from(broadcastRaw);
    expect(parsed.type).toBe(0); // legacy — accepted by all public nodes
    expect(parsed.nonce).toBe(7);
    expect(parsed.gasPrice).toBe(101n);
    expect(parsed.to?.toLowerCase()).toBe(USDC_BASE_SEPOLIA.toLowerCase());
    expect(parsed.data?.startsWith("0xe3ee160e")).toBe(true); // transferWithAuthorization selector
  });
});
