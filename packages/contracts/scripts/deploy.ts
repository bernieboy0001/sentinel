import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Wallet as EthersWallet } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { AuditRegistry, MintableERC20, MinimalAMM } from "../typechain-types";

const GAS_PRICE = 2000000000n; // 2 gwei — cheap on Base, constant so any
// re-broadcast is an equal-fee replacement (never "underpriced").

/**
 * Deterministic nonce source. Public testnet RPCs race resends against
 * their own mempool ("replacement transaction underpriced" / "nonce too
 * low"), so we own the nonce explicitly: one +1 per send, resync only on
 * an explicit conflict.
 */
function makeNonce(provider: typeof ethers.provider, owner: string) {
  let next: number | null = null;
  return {
    next: async () => {
      if (next === null) next = await provider.getTransactionCount(owner);
      return next++;
    },
    reset: async () => {
      next = await provider.getTransactionCount(owner);
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeRelay(provider: typeof ethers.provider, owner: string) {
  const nonce = makeNonce(provider, owner);
  return {
    nonce,
    overrides: async () => ({ nonce: await nonce.next(), gasPrice: GAS_PRICE }),
    async send<T>(
      build: (ov: { nonce: number; gasPrice: bigint }) => Promise<{ wait: () => Promise<T> }>
    ): Promise<T> {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const tx = await build(await this.overrides());
          return await tx.wait();
        } catch (e) {
          const m = String((e as Error).message || e);
          // Transient public-RPC failures: nonce races, underpriced
          // replacements, and socket drops. Not fatal — resync the nonce
          // from the chain and try again.
          if (/(underpriced|nonce too (low|high)|replacement|already known|timeout|NONCE_|socket|closed|ECONNRESET|ETIMEDOUT|ESOCKET|connection|server error|network error|UNKNOWN_ERROR)/i.test(m)) {
            console.log(`   ↻ transient: ${m.slice(0, 70)} — wait & resync`);
            await sleep(12000);
            await nonce.reset();
            continue;
          }
          throw e;
        }
      }
      throw new Error("deploy tx retries exhausted");
    }
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const relay = makeRelay(ethers.provider, deployer.address);
  const ov = () => relay.overrides();

  const Token = await ethers.getContractFactory("MintableERC20");
  console.log("  deploy AUTH token...");
  const auth = (await Token.deploy("AUTH", "AUTH", await ov())) as unknown as MintableERC20;
  await auth.waitForDeployment();
  console.log("  deploy AUDS token...");
  const auds = (await Token.deploy("AUDS", "AUDS", await ov())) as unknown as MintableERC20;
  await auds.waitForDeployment();

  console.log("  deploy AMM...");
  const AMM = await ethers.getContractFactory("MinimalAMM");
  const amm = (await AMM.deploy(await auth.getAddress(), await auds.getAddress(), await ov())) as unknown as MinimalAMM;
  await amm.waitForDeployment();

  console.log("  deploy AuditRegistry...");
  const Audit = await ethers.getContractFactory("AuditRegistry");
  const audit = (await Audit.deploy(await ov())) as unknown as AuditRegistry;
  await audit.waitForDeployment();

  // Seed liquidity: 1,000,000 AUTH vs 100,000 AUDS  ->  price 10 AUDS per AUTH
  console.log("  seed pool liquidity...");
  await relay.send(async (o) => auth.connect(deployer).mint(await amm.getAddress(), ethers.parseEther("1000000"), o));
  await relay.send(async (o) => auds.connect(deployer).mint(await amm.getAddress(), ethers.parseEther("100000"), o));
  await relay.send(async (o) => amm.initializeLiquidity(ethers.parseEther("1000000"), ethers.parseEther("100000"), o));

  // Fund the agent treasury — mostly stable (AUDS), a little AUTH, so the
  // exposure guard has room to actually matter during the demo.
  const agentWallet = process.env.AGENT_PRIVATE_KEY
    ? new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, ethers.provider)
    : deployer;
  const agentAddress = await agentWallet.getAddress();
  console.log("  fund agent treasury...");
  await relay.send(async (o) => auth.connect(deployer).mint(agentAddress, ethers.parseEther("2000"), o));
  await relay.send(async (o) => auds.connect(deployer).mint(agentAddress, ethers.parseEther("100000"), o));

  // Fund the demo market maker so it can create price movement
  let marketMakerAddress = deployer.address;
  let marketMakerWallet: HardhatEthersSigner | EthersWallet = deployer;
  if (process.env.MARKET_MAKER_PRIVATE_KEY) {
    marketMakerWallet = new ethers.Wallet(process.env.MARKET_MAKER_PRIVATE_KEY, ethers.provider);
    marketMakerAddress = await marketMakerWallet.getAddress();
  }
  console.log("  fund market maker...");
  await relay.send(async (o) => auth.connect(deployer).mint(marketMakerAddress, ethers.parseEther("200000"), o));
  await relay.send(async (o) => auds.connect(deployer).mint(marketMakerAddress, ethers.parseEther("200000"), o));

  // Pre-approve the AMM for the agent and market maker wallets so no approval
  // transaction is ever needed inside the live loop. (Each wallet has its own
  // nonce relay — approvals are signed by those wallets, not the deployer.)
  console.log("  pre-approve agent wallet...");
  const agentRelay = makeRelay(ethers.provider, agentAddress);
  await agentRelay.send(
    async (o) => auth.connect(agentWallet).approve(await amm.getAddress(), ethers.MaxUint256, o)
  );
  await agentRelay.send(
    async (o) => auds.connect(agentWallet).approve(await amm.getAddress(), ethers.MaxUint256, o)
  );

  console.log("  pre-approve market maker...");
  const mmRelay = makeRelay(ethers.provider, marketMakerAddress);
  await mmRelay.send(
    async (o) => auth.connect(marketMakerWallet).approve(await amm.getAddress(), ethers.MaxUint256, o)
  );
  await mmRelay.send(
    async (o) => auds.connect(marketMakerWallet).approve(await amm.getAddress(), ethers.MaxUint256, o)
  );

  // Genesis audit entry
  console.log("  commit genesis audit entry...");
  const genesisHash = ethers.keccak256(ethers.toUtf8Bytes("SENTINEL genesis: treasury initialized"));
  await relay.send(async (o) => audit.commit(genesisHash, "SENTINEL genesis: treasury initialized", o));

  const out = {
    network: process.env.HARDHAT_NETWORK || "hardhat",
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    agent: agentAddress,
    marketMaker: marketMakerAddress,
    tokens: { auth: await auth.getAddress(), auds: await auds.getAddress() },
    amm: await amm.getAddress(),
    auditRegistry: await audit.getAddress(),
    initialLiquidity: { auth: ethers.parseEther("1000000").toString(), auds: ethers.parseEther("100000").toString() },
    genesisHash
  };

  const dataDir = path.join(__dirname, "../../../.data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "deployed.json"), JSON.stringify(out, null, 2));
  console.log("Deployed:", JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});