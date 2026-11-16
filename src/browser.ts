/**
 * GiwaPad — live launchpad data for GIWA Sepolia, powered by @ammora-protocol/sdk.
 * All reads are keyless public-client calls against the Ammora V4 auto-route
 * deployment, mirroring the official list-configs quickstart flow.
 */
import { createPublicClient, defineChain, http } from "viem";
import {
  giwaSepoliaAutoRoute,
  giwaSepoliaAutoRouteDeployment,
  resolveAmmoraFinalizedHead,
  getAmmoraV4ConfigAtBlock,
  getAmmoraV4NextConfigId,
  verifyAmmoraV4CoreAtBlock,
} from "@ammora-protocol/sdk";

type ConfigRow = {
  configId: string;
  enabled: boolean;
  configHash: string;
  owner: string;
  feeClaimer: string;
  quoteToken: string;
  migrationMode: number;
  segments: number;
};

declare global {
  interface Window {
    __SNAPSHOT__?: { blockNumber: string; nextConfigId: string; configs: ConfigRow[] };
  }
}

const $ = (id: string) => document.getElementById(id);
const short = (addr: string) => (addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr);

function renderConfigs(configs: ConfigRow[]) {
  const body = $("configs-body");
  if (!body) return;
  body.innerHTML = configs
    .map(
      (c) => `<tr>
        <td class="num">#${c.configId}</td>
        <td><span class="badge ${c.enabled ? "on" : "off"}">${c.enabled ? "Enabled" : "Disabled"}</span></td>
        <td class="mono">${short(c.owner)}</td>
        <td class="mono">${short(c.quoteToken)}</td>
        <td class="num">${c.segments}</td>
        <td class="mono">${short(c.configHash)}</td>
      </tr>`,
    )
    .join("");
}

function setStatus(text: string, ok: boolean) {
  const el = $("live-status");
  if (el) {
    el.textContent = text;
    el.className = ok ? "status ok" : "status warn";
  }
}

async function main() {
  const deployment = giwaSepoliaAutoRouteDeployment;
  const contracts = deployment.contracts.launch;
  const rpcUrl = "https://sepolia-rpc.giwa.io";
  const chain = defineChain({
    id: deployment.chain.id,
    name: deployment.chain.name,
    nativeCurrency: deployment.chain.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 30_000 }) });

  // Live block ticker (plain client read).
  const tick = async () => {
    try {
      const bn = await client.getBlockNumber();
      const el = $("stat-block");
      if (el) el.textContent = bn.toLocaleString("en-US");
    } catch { /* keep last value */ }
  };
  void tick();
  setInterval(tick, 15_000);

  try {
    const chainId = await client.getChainId();
    if (chainId !== 91342) throw new Error(`unexpected chain ${chainId}`);

    const blockNumber = await resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality);

    // Verify the V4 core contracts at the finalized block, exactly like the quickstart.
    let verified = false;
    try {
      await verifyAmmoraV4CoreAtBlock(
        client,
        {
          configRegistry: contracts.configRegistry,
          launchFactory: contracts.factory,
          graduationAdapter: contracts.graduationAdapter,
          feePolicy: contracts.feePolicy,
        },
        blockNumber,
      );
      verified = true;
    } catch { /* verification is a bonus badge; reads below still stand on their own */ }

    const nextConfigId = await getAmmoraV4NextConfigId(client, contracts.configRegistry, blockNumber);
    const registered = nextConfigId > 1n ? nextConfigId - 1n : 0n;
    const statEl = $("stat-configs");
    if (statEl) statEl.textContent = registered.toString();

    const limit = registered > 10n ? 10 : Number(registered);
    const configs: ConfigRow[] = [];
    for (let i = 1; i <= limit; i++) {
      if (i > 1) await new Promise((r) => setTimeout(r, 350));
      const entry = await getAmmoraV4ConfigAtBlock(client, contracts.configRegistry, BigInt(i), blockNumber);
      configs.push({
        configId: entry.configId.toString(),
        enabled: entry.enabled,
        configHash: entry.configHash,
        owner: entry.identity.owner,
        feeClaimer: entry.identity.feeClaimer,
        quoteToken: entry.config.quoteToken,
        migrationMode: entry.config.migrationMode,
        segments: entry.segments.length,
      });
    }
    renderConfigs(configs);
    setStatus(
      `Live from Ammora contracts via @ammora-protocol/sdk · finalized block ${blockNumber.toLocaleString("en-US")}${verified ? " · V4 core verified on-chain ✓" : ""}`,
      true,
    );
  } catch (err) {
    // Fallback: snapshot captured with the same SDK flow (see configs-snapshot.json).
    const snap = window.__SNAPSHOT__;
    if (snap) {
      renderConfigs(snap.configs);
      const statEl = $("stat-configs");
      if (statEl) statEl.textContent = (BigInt(snap.nextConfigId) - 1n).toString();
      setStatus(`Live RPC unreachable from your browser — showing SDK snapshot from block ${Number(snap.blockNumber).toLocaleString("en-US")}`, false);
    } else {
      setStatus("Could not reach the GIWA Sepolia RPC. Please reload.", false);
    }
    console.error(err);
  }
}

void main();
