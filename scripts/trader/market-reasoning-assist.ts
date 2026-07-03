/**
 * SEE-R2 — Market Intelligence reasoning assist for Strategy Evolution.
 *
 * Usage:
 *   pnpm trader:see:reason -- \
 *     --vault-dir=./replay-runs/RI-P7/dee-371-artifact-check
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 * Read-only: loads vault JSON, writes reasoning-context + market-reasoning-proposal only.
 */

import { resolve } from "node:path";

import { runMarketReasoningAssist } from "@/lib/trader/research/run-market-reasoning-assist";

const LOG_PREFIX = "[trader:see:reason]";

export function printMarketReasoningAssistUsage(): void {
  console.log(`SEE-R2 — market reasoning assist

Usage:
  pnpm trader:see:reason -- \\
    --vault-dir=./replay-runs/RI-P7/dee-371-artifact-check

Environment (default: fake provider — no secrets required):
  WAIA_TRADER_CLI=1
  WAIA_TRADER_SEE_AI_REASONING=1
  WAIA_AI_TRADER_GATEWAY_FOUNDATION=1
  WAIA_AI_TRADER_PROVIDER=openai-compatible
  WAIA_AI_TRADER_PROVIDER_LIFECYCLE=sandbox|production
  WAIA_AI_TRADER_OPENAI_API_KEY           (separate from Twin WAIA_AI_OPENAI_API_KEY)
  WAIA_AI_TRADER_OPENAI_MODEL=gpt-4o-mini
  WAIA_AI_TRADER_OPENAI_MAX_OUTPUT_TOKENS=2048
  WAIA_AI_TRADER_OPENAI_MAX_RETRIES=2`);
}

function parseFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, true);
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.has("help")) {
    printMarketReasoningAssistUsage();
    return;
  }

  const vaultDir = resolve(
    String(flags.get("vault-dir") ?? "./replay-runs/RI-P7/dee-371-artifact-check"),
  );

  const result = await runMarketReasoningAssist({ vaultDir });

  console.error(
    `${LOG_PREFIX} sessionId=${result.reasoningSessionId} providerId=${result.providerId} ` +
      `context=${result.reasoningContextPath} audit=${result.reasoningSessionAuditPath} ` +
      `proposal=${result.proposalPath} digest=${result.proposal.envelope.contentDigest}`,
  );
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
