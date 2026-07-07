/**
 * Full Market Data Integration — read-only repository audit (DEE-393).
 *
 * Validates 20/20 provider registry parity, adapter/gateway coverage, env
 * documentation, cron env bridging, fused context v2, and provider-readiness
 * compatibility. Does not call live providers.
 *
 * Usage:
 *   pnpm validate:market-data-integration
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  FUSED_CONTEXT_SCHEMA_VERSION,
  MARKET_DATA_PROVIDER_IDS,
} from "@/lib/trader/market-data/observation-types";
import { listMarketDataProviders } from "@/lib/trader/market-data/provider-registry";
import {
  runProviderReadinessAudit,
  type ReadinessFinding,
  type ReadinessReport,
} from "./validate-provider-readiness";

export type IntegrationFinding = ReadinessFinding;

export type IntegrationReport = {
  pass: boolean;
  findings: IntegrationFinding[];
};

const EXPECTED_PROVIDER_COUNT = 20;

const NEW_INTEGRATION_ENV_VARS = [
  "FRED_API_KEY",
  "AI_TRADER_INFURA_PROJECT_ID",
  "AI_TRADER_INFURA_API_SECRET",
  "AI_TRADER_TRONGRID_API_KEY",
  "AI_TRADER_GITHUB_TOKEN",
  "AI_TRADER_SEC_EDGAR_USER_AGENT",
  "AI_TRADER_CME_FEDWATCH_ENABLED",
] as const;

const GATEWAY_HANDLED_PROVIDERS: Record<string, readonly string[]> = {
  htx_spot: ["HtxRestClient", "HtxDepthAdapter"],
  binance_public: ["BinancePublicMarketClient"],
  bybit_public: ["BybitPublicMarketClient"],
  alternative_me: ["AlternativeMeFearGreedClient"],
  coingecko_global: ["CoinGeckoGlobalMarketClient"],
};

const ADAPTER_FILE_BY_PROVIDER: Record<string, string> = {
  fred: "fred-adapter.ts",
  federal_reserve: "federal-reserve-adapter.ts",
  cme_fedwatch: "cme-fedwatch-adapter.ts",
  gdelt: "gdelt-adapter.ts",
  coindesk_rss: "coindesk-rss-adapter.ts",
  cointelegraph_rss: "cointelegraph-rss-adapter.ts",
  decrypt_rss: "decrypt-rss-adapter.ts",
  binance_announcements: "binance-announcements-adapter.ts",
  htx_announcements: "htx-announcements-adapter.ts",
  bybit_announcements: "bybit-announcements-adapter.ts",
  github_releases: "github-releases-adapter.ts",
  infura_rpc: "infura-rpc-adapter.ts",
  trongrid_intelligence: "trongrid-intelligence-adapter.ts",
  mempool_space: "mempool-space-adapter.ts",
  sec_edgar: "sec-edgar-adapter.ts",
  htx_spot: "htx-depth-adapter.ts",
};

function readRepoFile(root: string, relativePath: string): string {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

export function auditProviderRegistryParity(root: string): IntegrationFinding {
  const observationTypes = readRepoFile(root, "lib/trader/market-data/observation-types.ts");
  const registry = readRepoFile(root, "lib/trader/market-data/provider-registry.ts");

  const missingFromRegistry = MARKET_DATA_PROVIDER_IDS.filter(
    (id) => !registry.includes(`id: "${id}"`),
  );
  const missingFromObservationTypes = MARKET_DATA_PROVIDER_IDS.filter(
    (id) => !observationTypes.includes(`"${id}"`),
  );
  const registryCount = listMarketDataProviders().length;
  const observationCount = MARKET_DATA_PROVIDER_IDS.length;

  const pass =
    missingFromRegistry.length === 0 &&
    missingFromObservationTypes.length === 0 &&
    registryCount === EXPECTED_PROVIDER_COUNT &&
    observationCount === EXPECTED_PROVIDER_COUNT;

  const detail = pass
    ? `All ${EXPECTED_PROVIDER_COUNT} MARKET_DATA_PROVIDER_IDS match provider-registry.ts and observation-types.ts.`
    : [
        missingFromRegistry.length > 0
          ? `registry missing: ${missingFromRegistry.join(", ")}`
          : null,
        missingFromObservationTypes.length > 0
          ? `observation-types missing: ${missingFromObservationTypes.join(", ")}`
          : null,
        registryCount !== EXPECTED_PROVIDER_COUNT ? `registry count ${registryCount}` : null,
        observationCount !== EXPECTED_PROVIDER_COUNT
          ? `observation count ${observationCount}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");

  return { id: "provider-registry-parity", pass, detail };
}

export function auditProviderAdapterCoverage(root: string): IntegrationFinding {
  const gateway = readRepoFile(root, "lib/trader/market-data/market-data-gateway.ts");
  const adapterDir = join(root, "lib/trader/market-data/adapters");
  const adapterFiles = existsSync(adapterDir) ? readdirSync(adapterDir) : [];

  const uncovered: string[] = [];

  for (const providerId of MARKET_DATA_PROVIDER_IDS) {
    const gatewayMarkers = GATEWAY_HANDLED_PROVIDERS[providerId];
    if (gatewayMarkers) {
      const gatewayCovered = gatewayMarkers.every((marker) => gateway.includes(marker));
      if (!gatewayCovered) {
        uncovered.push(`${providerId} (gateway markers: ${gatewayMarkers.join(", ")})`);
      }
      continue;
    }

    const adapterFile = ADAPTER_FILE_BY_PROVIDER[providerId];
    if (!adapterFile || !adapterFiles.includes(adapterFile)) {
      uncovered.push(`${providerId} (missing adapter ${adapterFile ?? "unknown"})`);
    }
  }

  return {
    id: "provider-adapter-coverage",
    pass: uncovered.length === 0,
    detail:
      uncovered.length === 0
        ? "Each provider has an adapter module or is wired in market-data-gateway.ts."
        : `Uncovered providers: ${uncovered.join("; ")}`,
  };
}

export function auditIntegrationEnvTemplates(root: string): IntegrationFinding {
  const envExample = readRepoFile(root, ".env.example");
  const devVars = readRepoFile(root, ".dev.vars.example");
  const cloudflareDoc = readRepoFile(root, "docs/cloudflare-env-vars.md");
  const combined = `${envExample}\n${devVars}\n${cloudflareDoc}`;

  const missing = NEW_INTEGRATION_ENV_VARS.filter((name) => !combined.includes(name));
  const missingEnvExample = NEW_INTEGRATION_ENV_VARS.filter((name) => !envExample.includes(name));
  const missingDevVars = NEW_INTEGRATION_ENV_VARS.filter((name) => !devVars.includes(name));
  const missingCloudflare = NEW_INTEGRATION_ENV_VARS.filter(
    (name) => !cloudflareDoc.includes(name),
  );

  const pass = missing.length === 0;

  return {
    id: "integration-env-templates",
    pass,
    detail: pass
      ? "All 7 integration env vars documented in .env.example, .dev.vars.example, and cloudflare-env-vars.md."
      : [
          missingEnvExample.length > 0 ? `.env.example: ${missingEnvExample.join(", ")}` : null,
          missingDevVars.length > 0 ? `.dev.vars.example: ${missingDevVars.join(", ")}` : null,
          missingCloudflare.length > 0
            ? `cloudflare-env-vars.md: ${missingCloudflare.join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function auditIntegrationCronEnvBridge(root: string): IntegrationFinding {
  const bridge = readRepoFile(root, "lib/trader/cron/worker-cron-env.ts");
  const missing = NEW_INTEGRATION_ENV_VARS.filter(
    (name) => !bridge.includes(`bridgeEnvKey(env, "${name}")`),
  );

  return {
    id: "integration-cron-env-bridge",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? "worker-cron-env.ts bridges all 7 integration env vars."
        : `Missing cron bridges: ${missing.join(", ")}`,
  };
}

export function auditGatewayUsesFuseContextV1(root: string): IntegrationFinding {
  const gateway = readRepoFile(root, "lib/trader/market-data/market-data-gateway.ts");
  const pass =
    gateway.includes("fuseContextV1") &&
    gateway.includes('from "@/lib/trader/market-data/fusion/context-fusion-v1"');
  return {
    id: "gateway-fuse-context-v1",
    pass,
    detail: pass
      ? "market-data-gateway.ts imports and calls fuseContextV1."
      : "Gateway must use fuseContextV1 from context-fusion-v1.ts.",
  };
}

export function auditTronGridIntelligenceEnvBoundary(root: string): IntegrationFinding {
  const client = readRepoFile(
    root,
    "lib/trader/connectors/trongrid-intelligence/trongrid-intelligence-client.ts",
  );
  const withoutPrefixed = client.replaceAll("AI_TRADER_TRONGRID_API_KEY", "");
  const pass =
    client.includes("AI_TRADER_TRONGRID_API_KEY") && !withoutPrefixed.includes("TRONGRID_API_KEY");
  return {
    id: "trongrid-intelligence-env",
    pass,
    detail: pass
      ? "trongrid-intelligence-client.ts uses AI_TRADER_TRONGRID_API_KEY only."
      : "TronGrid intelligence client must use AI_TRADER_TRONGRID_API_KEY, not TRONGRID_API_KEY.",
  };
}

export function auditOrderBookSnapshotNormalizer(root: string): IntegrationFinding {
  const normalizer = readRepoFile(
    root,
    "lib/trader/market-data/normalization/normalize-observation.ts",
  );
  const pass =
    normalizer.includes("export function normalizeOrderBookSnapshotObservation") &&
    normalizer.includes('kind: "order_book_snapshot"');
  return {
    id: "order-book-snapshot-normalizer",
    pass,
    detail: pass
      ? "normalizeOrderBookSnapshotObservation exists in normalize-observation.ts."
      : "Implement normalizeOrderBookSnapshotObservation for order_book_snapshot kind.",
  };
}

export function auditFusedContextSchemaV2(): IntegrationFinding {
  const pass = FUSED_CONTEXT_SCHEMA_VERSION === "waia.trader.fused_context.v2";
  return {
    id: "fused-context-schema-v2",
    pass,
    detail: pass
      ? "FUSED_CONTEXT_SCHEMA_VERSION is waia.trader.fused_context.v2."
      : `Expected waia.trader.fused_context.v2, got ${FUSED_CONTEXT_SCHEMA_VERSION}.`,
  };
}

export function auditProviderReadinessCompatibility(root: string): IntegrationFinding {
  const report: ReadinessReport = runProviderReadinessAudit(root);
  const failures = report.findings.filter((finding) => !finding.pass);
  return {
    id: "provider-readiness-compatibility",
    pass: report.pass,
    detail: report.pass
      ? "runProviderReadinessAudit passes with updated DEE-393 rules."
      : `Provider readiness failures: ${failures.map((f) => f.id).join(", ")}`,
  };
}

export function auditIntegrationRunbook(root: string): IntegrationFinding {
  const path = "docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md";
  if (!existsSync(join(root, path))) {
    return {
      id: "integration-runbook",
      pass: false,
      detail: `Missing ${path}.`,
    };
  }
  const runbook = readRepoFile(root, path);
  const pass =
    runbook.includes("validate:market-data-integration") &&
    runbook.includes("Full Market Data Source Integration") &&
    runbook.includes("Repeat M9");
  return {
    id: "integration-runbook",
    pass,
    detail: pass
      ? "DEE-393 integration runbook exists with validation and Repeat M9 guidance."
      : "DEE-393 runbook must document integration validation and Repeat M9 gate.",
  };
}

export function auditIntegrationPackageScript(root: string): IntegrationFinding {
  const pkg = readRepoFile(root, "package.json");
  return {
    id: "integration-package-script",
    pass: pkg.includes('"validate:market-data-integration"'),
    detail: pkg.includes('"validate:market-data-integration"')
      ? "package.json exposes validate:market-data-integration."
      : "Add validate:market-data-integration script to package.json.",
  };
}

export function runMarketDataIntegrationAudit(root = process.cwd()): IntegrationReport {
  const findings: IntegrationFinding[] = [
    auditProviderRegistryParity(root),
    auditProviderAdapterCoverage(root),
    auditIntegrationEnvTemplates(root),
    auditIntegrationCronEnvBridge(root),
    auditGatewayUsesFuseContextV1(root),
    auditTronGridIntelligenceEnvBoundary(root),
    auditOrderBookSnapshotNormalizer(root),
    auditFusedContextSchemaV2(),
    auditProviderReadinessCompatibility(root),
    auditIntegrationRunbook(root),
    auditIntegrationPackageScript(root),
  ];
  return {
    pass: findings.every((finding) => finding.pass),
    findings,
  };
}

function main(): void {
  const report = runMarketDataIntegrationAudit();
  for (const finding of report.findings) {
    const label = finding.pass ? "PASS" : "FAIL";
    console.log(`${label}  ${finding.id}: ${finding.detail}`);
  }
  if (!report.pass) {
    console.error("\nMarket data integration audit FAILED.");
    process.exitCode = 1;
    return;
  }
  console.log("\nMarket data integration audit PASSED.");
}

const isDirectRun = process.argv[1]?.endsWith("validate-market-data-integration.ts") ?? false;
if (isDirectRun) {
  main();
}
