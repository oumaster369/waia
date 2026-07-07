/**
 * Data Provider Readiness — read-only repository audit (DEE-392).
 *
 * Validates operator/env documentation parity, env template coverage,
 * gateway env bridging, and research bypass guards. Does not call live providers.
 *
 * Usage:
 *   pnpm validate:provider-readiness
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ReadinessFinding = {
  id: string;
  pass: boolean;
  detail: string;
};

export type ReadinessReport = {
  pass: boolean;
  findings: ReadinessFinding[];
};

function readRepoFile(root: string, relativePath: string): string {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

const REQUIRED_REGISTRY_IDS = [
  "htx_spot",
  "binance_public",
  "bybit_public",
  "alternative_me",
  "coingecko_global",
] as const;

const REQUIRED_ENV_IN_EXAMPLE = [
  "HTX_REST_HOST",
  "COINGECKO_API_KEY",
  "MARKET_BRAIN_ENABLED",
  "MARKET_BRAIN_ORGANIZATION_ID",
  "WATCHER_USDT_CONTRACT",
  "WAIA_HTX_LIVE_SMOKE",
] as const;

const REQUIRED_DEV_VARS = [
  "HTX_REST_HOST",
  "COINGECKO_API_KEY",
  "MARKET_BRAIN_ENABLED",
  "MARKET_BRAIN_ORGANIZATION_ID",
  "PAPER_LOOP_ENABLED",
] as const;

const FORBIDDEN_INVENTED_ENV = ["FRED_API_KEY", "INFURA_API_KEY", "INFURA_PROJECT_ID"] as const;

const BINDING_SPEC_SECTIONS = [
  "Canonical 20-source tier table",
  "Repeat M9 required vs deferred",
  "Environment and secrets",
  "Provider health observability",
  "Gateway bypass inventory",
  "Known implementation gaps",
  "order_book_snapshot",
] as const;

const REQUIRED_DOCS = [
  "docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md",
  "docs/ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md",
  "docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md",
] as const;

const RESEARCH_FORBIDDEN_IMPORTS = [
  "connectors/binance",
  "connectors/bybit",
  "connectors/alternative-me",
  "connectors/coingecko",
  "connectors/htx/client",
  "market-data-gateway",
] as const;

export function auditProviderRegistry(root: string): ReadinessFinding {
  const registry = readRepoFile(root, "lib/trader/market-data/provider-registry.ts");
  const missing = REQUIRED_REGISTRY_IDS.filter((id) => !registry.includes(`id: "${id}"`));
  return {
    id: "provider-registry",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? "All Repeat-M9 registry entries present."
        : `Missing registry IDs: ${missing.join(", ")}`,
  };
}

export function auditCronEnvBridge(root: string): ReadinessFinding {
  const bridge = readRepoFile(root, "lib/trader/cron/worker-cron-env.ts");
  const pass =
    bridge.includes('bridgeEnvKey(env, "HTX_REST_HOST")') &&
    bridge.includes('bridgeEnvKey(env, "COINGECKO_API_KEY")');
  return {
    id: "cron-env-bridge",
    pass,
    detail: pass
      ? "HTX_REST_HOST and COINGECKO_API_KEY bridged for Worker cron."
      : "worker-cron-env.ts must bridge HTX_REST_HOST and COINGECKO_API_KEY.",
  };
}

export function auditEnvExample(root: string): ReadinessFinding {
  const envExample = readRepoFile(root, ".env.example");
  const missing = REQUIRED_ENV_IN_EXAMPLE.filter((name) => !envExample.includes(name));
  return {
    id: "env-example",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? ".env.example documents required MI env names."
        : `Missing from .env.example: ${missing.join(", ")}`,
  };
}

export function auditDevVarsExample(root: string): ReadinessFinding {
  const devVars = readRepoFile(root, ".dev.vars.example");
  const missing = REQUIRED_DEV_VARS.filter((name) => !devVars.includes(name));
  return {
    id: "dev-vars-example",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? ".dev.vars.example documents MI worker preview vars."
        : `Missing from .dev.vars.example: ${missing.join(", ")}`,
  };
}

export function auditNoInventedEnvVars(root: string): ReadinessFinding {
  const envExample = readRepoFile(root, ".env.example");
  const devVars = readRepoFile(root, ".dev.vars.example");
  const combined = `${envExample}\n${devVars}`;
  const found = FORBIDDEN_INVENTED_ENV.filter((name) => combined.includes(name));
  return {
    id: "no-invented-env",
    pass: found.length === 0,
    detail:
      found.length === 0
        ? "No deferred FRED/Infura env vars invented in templates."
        : `Remove invented env vars from templates: ${found.join(", ")}`,
  };
}

export function auditBindingSpecSections(root: string): ReadinessFinding {
  const doc = readRepoFile(root, "docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md");
  const missing = BINDING_SPEC_SECTIONS.filter((section) => !doc.includes(section));
  return {
    id: "binding-spec-sections",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? "AI-TRADER-DATA-PROVIDERS.md contains required readiness sections."
        : `Missing binding spec sections: ${missing.join(", ")}`,
  };
}

export function auditRequiredDocs(root: string): ReadinessFinding {
  const missing = REQUIRED_DOCS.filter((path) => !existsSync(join(root, path)));
  return {
    id: "required-docs",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? "Operator runbook and validation checklist exist."
        : `Missing docs: ${missing.join(", ")}`,
  };
}

export function auditResearchBypassGuard(root: string): ReadinessFinding {
  const researchDir = join(root, "lib/trader/research");
  const files = readdirSync(researchDir).filter((name) => name.endsWith(".ts"));
  const violations: string[] = [];
  for (const file of files) {
    const content = readFileSync(join(researchDir, file), "utf8");
    for (const pattern of RESEARCH_FORBIDDEN_IMPORTS) {
      if (content.includes(pattern)) {
        violations.push(`${file} imports ${pattern}`);
      }
    }
  }
  return {
    id: "research-bypass-guard",
    pass: violations.length === 0,
    detail:
      violations.length === 0
        ? "Research modules do not import external provider clients directly."
        : violations.join("; "),
  };
}

export function auditCloudflareEnvInventory(root: string): ReadinessFinding {
  const doc = readRepoFile(root, "docs/cloudflare-env-vars.md");
  const required = [
    "HTX_REST_HOST",
    "COINGECKO_API_KEY",
    "MARKET_BRAIN_ENABLED",
    "TRONGRID_API_KEY",
  ];
  const missing = required.filter((name) => !doc.includes(name));
  return {
    id: "cloudflare-env-inventory",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? "cloudflare-env-vars.md inventories AI-TRADER MI vars."
        : `Missing from cloudflare-env-vars.md: ${missing.join(", ")}`,
  };
}

export function auditStatusDocs(root: string): ReadinessFinding {
  const status = readRepoFile(root, "replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md");
  const gateA = readRepoFile(
    root,
    "replay-runs/RI-P7/m9-v2-research-campaign-org0/GATE-A-VALIDATION.md",
  );
  const pass =
    status.includes("Data Provider Readiness") &&
    status.includes("Full Market Data Source Integration") &&
    status.includes("Repeat M9") &&
    gateA.includes("Data Provider Readiness") &&
    gateA.includes("Full Market Data Source Integration") &&
    gateA.includes("Repeat M9") &&
    gateA.includes("BLOCKED");
  return {
    id: "status-docs",
    pass,
    detail: pass
      ? "Engineering status and Gate A docs reflect provider-readiness sequence."
      : "Update AI-TRADER-ENGINEERING-STATUS.md and GATE-A-VALIDATION.md.",
  };
}

export function auditRunbookProvisioningSequence(root: string): ReadinessFinding {
  const runbook = readRepoFile(root, "docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md");
  const pass =
    runbook.includes("Post-merge Operator Provisioning Sequence") &&
    runbook.includes("Merge this PR into dev") &&
    runbook.includes("HTX trade credentials are NEVER placed in .env files") &&
    runbook.includes("Full Market Data Source Integration");
  return {
    id: "runbook-provisioning-sequence",
    pass,
    detail: pass
      ? "Runbook contains post-merge operator provisioning sequence."
      : "Runbook must include Post-merge Operator Provisioning Sequence section.",
  };
}

export function auditPackageScript(root: string): ReadinessFinding {
  const pkg = readRepoFile(root, "package.json");
  return {
    id: "package-script",
    pass: pkg.includes('"validate:provider-readiness"'),
    detail: pkg.includes('"validate:provider-readiness"')
      ? "package.json exposes validate:provider-readiness."
      : "Add validate:provider-readiness script to package.json.",
  };
}

export function runProviderReadinessAudit(root = process.cwd()): ReadinessReport {
  const findings: ReadinessFinding[] = [
    auditProviderRegistry(root),
    auditCronEnvBridge(root),
    auditEnvExample(root),
    auditDevVarsExample(root),
    auditNoInventedEnvVars(root),
    auditBindingSpecSections(root),
    auditRequiredDocs(root),
    auditResearchBypassGuard(root),
    auditCloudflareEnvInventory(root),
    auditStatusDocs(root),
    auditRunbookProvisioningSequence(root),
    auditPackageScript(root),
  ];
  return {
    pass: findings.every((finding) => finding.pass),
    findings,
  };
}

function main(): void {
  const report = runProviderReadinessAudit();
  for (const finding of report.findings) {
    const label = finding.pass ? "PASS" : "FAIL";
    console.log(`${label}  ${finding.id}: ${finding.detail}`);
  }
  if (!report.pass) {
    console.error("\nProvider readiness audit FAILED.");
    process.exitCode = 1;
    return;
  }
  console.log("\nProvider readiness audit PASSED.");
}

const isDirectRun = process.argv[1]?.endsWith("validate-provider-readiness.ts") ?? false;
if (isDirectRun) {
  main();
}
