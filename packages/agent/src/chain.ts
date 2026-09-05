import { ethers } from "ethers";
import { Config } from "./config.js";

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

export const AMM_ABI = [
  "function getReserves() view returns (uint256,uint256)",
  "function getPrice() view returns (uint256)",
  "function getAmountOut(uint256,uint256,uint256) view returns (uint256)",
  "function swap(address,uint256,uint256) returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

export const AUDIT_ABI = [
  "function commit(bytes32,string) returns (uint256)",
  "function entryCount() view returns (uint256)",
  "function latest() view returns (uint256,bytes32,address,string)"
];

export interface Chain {
  provider: ethers.Provider;
  agent: ethers.Wallet;
  mm: ethers.Wallet;
  tokens: { auth: string; auds: string };
  amm: string;
  auditRegistry: string;
}

/**
 * A wallet that owns a monotonically increasing nonce counter instead of
 * trusting the node's possibly-stale cached count on every send. The loop is
 * serialized (one awaited send at a time), so the counter can never collide.
 * On a broadcast rejection the counter rolls back so the send can retry.
 */
class NoncedWallet extends ethers.Wallet {
  private _nextNonce: number | null = null;

  override async sendTransaction(
    tx: ethers.TransactionRequest
  ): Promise<ethers.TransactionResponse> {
    if (this._nextNonce == null) {
      this._nextNonce = await this.provider!.getTransactionCount(
        this.address,
        "pending"
      );
    }
    const nonce: number = this._nextNonce;
    this._nextNonce += 1;
    try {
      return await super.sendTransaction({ ...tx, nonce });
    } catch (e) {
      this._nextNonce -= 1;
      throw e;
    }
  }
}

export function connectChain(config: Config): Chain {
  // Multiple RPCs, same network: FallbackProvider transparently retries across
  // them (sepolia.base.org is flaky — occasional TLS failures). Requests wait
  // and one provider answers, so calls don't stall on a dead endpoint.
  const provider = createProvider(config.rpcUrls);
  // Serialized sends + explicit nonces = no drift (NonceManager desyncs under
  // automining rejections, plain wallets hit rare stale-count races).
  const agent = new NoncedWallet(config.agentPrivateKey, provider);
  const mm = new NoncedWallet(config.marketMakerPrivateKey, provider);
  return {
    provider,
    agent,
    mm,
    tokens: config.deployed.tokens,
    amm: config.deployed.amm,
    auditRegistry: config.deployed.auditRegistry
  };
}

function createProvider(rpcUrls: string[]): ethers.Provider {
  if (rpcUrls.length === 1) {
    return new ethers.JsonRpcProvider(rpcUrls[0]);
  }
  const providers = rpcUrls.map((url, i) => ({
    provider: new ethers.JsonRpcProvider(url),
    priority: i,
    stallTimeout: 8000,
    weight: 1
  }));
  // quorum 1: public nodes drift apart (stale receipts, rejected txs); any
  // first response wins and higher-priority providers are preferred for reads.
  return new ethers.FallbackProvider(providers, undefined, { quorum: 1 });
}

export async function getReserves(chain: Chain): Promise<[bigint, bigint]> {
  const amm = new ethers.Contract(chain.amm, AMM_ABI, chain.provider);
  const [r0, r1] = (await amm.getReserves()) as [bigint, bigint];
  return [r0, r1];
}

/** AUDS per AUTH, as a plain number. */
export async function getPriceNum(chain: Chain): Promise<number> {
  const amm = new ethers.Contract(chain.amm, AMM_ABI, chain.provider);
  const p = (await amm.getPrice()) as bigint;
  return Number(p) / 1e18;
}

export async function getBalances(
  chain: Chain,
  who: string
): Promise<{ auth: bigint; auds: bigint }> {
  const authContract = new ethers.Contract(chain.tokens.auth, ERC20_ABI, chain.provider);
  const audsContract = new ethers.Contract(chain.tokens.auds, ERC20_ABI, chain.provider);
  const auth = (await authContract.balanceOf(who)) as bigint;
  const auds = (await audsContract.balanceOf(who)) as bigint;
  return { auth, auds };
}

export async function getAmountOut(
  chain: Chain,
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): Promise<bigint> {
  const amm = new ethers.Contract(chain.amm, AMM_ABI, chain.provider);
  return (await amm.getAmountOut(amountIn, reserveIn, reserveOut)) as bigint;
}

async function approveIfNeeded(
  chain: Chain,
  token: string,
  spender: string,
  amount: bigint,
  signer: ethers.AbstractSigner
): Promise<void> {
  const erc = new ethers.Contract(token, ERC20_ABI, signer);
  const signerAddress = await signer.getAddress();
  const allowance = (await erc.allowance(signerAddress, spender)) as bigint;
  if (allowance >= amount) return;
  const tx = await erc.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

export async function doSwap(
  chain: Chain,
  tokenIn: "auth" | "auds",
  amountIn: bigint,
  minOut: bigint,
  signer: ethers.AbstractSigner = chain.agent
): Promise<{ txHash: string }> {
  const amm = new ethers.Contract(chain.amm, AMM_ABI, signer);
  const tok = chain.tokens[tokenIn];
  await approveIfNeeded(chain, tok, chain.amm, amountIn, signer);
  const tx = await amm.swap(tok, amountIn, minOut);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("no receipt");
  return { txHash: receipt.hash };
}

export async function commitDecision(
  chain: Chain,
  hash: string,
  ref: string
): Promise<{ txHash: string; entryIndex: number }> {
  const audit = new ethers.Contract(chain.auditRegistry, AUDIT_ABI, chain.agent);
  const tx = await audit.commit(hash, ref);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("no receipt");
  const count = (await audit.entryCount()) as bigint;
  return { txHash: receipt.hash, entryIndex: Number(count) - 1 };
}
