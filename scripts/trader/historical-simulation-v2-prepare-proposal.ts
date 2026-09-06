import postgres from "postgres";
import { fileURLToPath } from "node:url";

import { waiaCampaignPostgresDriverOptions } from "../../db/postgres-client";
import { prepareHistoricalTechnicalProposalOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-split-v2";
import { runHistoricalTechnicalProposalCliV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-execution-cli-v2";
import { withHistoricalLaunchCleanupV2 } from
  "../../lib/trader/historical-simulation-v2/launch-cleanup-v2";
import { formatHistoricalLaunchErrorV2 } from
  "../../lib/trader/historical-simulation-v2/launch-error-format-v2";

export async function runHistoricalTechnicalProposalMainV2(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await runHistoricalTechnicalProposalCliV2(env,
    async (databaseUrl, input) => {
      const pool = postgres(databaseUrl, waiaCampaignPostgresDriverOptions());
      return withHistoricalLaunchCleanupV2(
        () => prepareHistoricalTechnicalProposalOnExecutionServerV2(pool, input),
        [() => pool.end({ timeout: 5 })],
      );
    });

  process.stdout.write(`${JSON.stringify({
    schemaVersion: "waia.trader.historical_technical_proposal_cli_result.v2",
    proposalId: result.id,
    proposalContentDigestHex: result.proposal.contentDigestHex,
  })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runHistoricalTechnicalProposalMainV2().catch((error: unknown) => {
    process.stderr.write(`${formatHistoricalLaunchErrorV2(error)}\n`);
    process.exitCode = 1;
  });
}
