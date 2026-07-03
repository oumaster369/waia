/**
 * SEE-R1 — Market Intelligence reasoning assist for Strategy Evolution.
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
  console.log(`SEE-R1 — market reasoning assist

Usage:
  pnpm trader:see:reason -- \\
    --vault-dir=./replay-runs/RI-P7/dee-371-artifact-check

Environment (R1 defaults to fake provider — no secrets required):
  WAIA_TRADER_CLI=1
  WAIA_TRADER_SEE_AI_REASONING=1          (required for R2 live egress)
  WAIA_AI_TRADER_GATEWAY_FOUNDATION=1     (R2)
  WAIA_AI_TRADER_PROVIDER=openai-compatible (R2)
  WAIA_AI_TRADER_OPENAI_API_KEY           (R2 — separate from Twin key)`);
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
    `${LOG_PREFIX} providerId=${result.providerId} ` +
      `context=${result.reasoningContextPath} proposal=${result.proposalPath} ` +
      `digest=${result.proposal.envelope.contentDigest}`,
  );
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
