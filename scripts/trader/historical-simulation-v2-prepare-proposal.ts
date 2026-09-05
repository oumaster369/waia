import postgres from "postgres";
import { fileURLToPath } from "node:url";

import { waiaCampaignPostgresDriverOptions } from "../../db/postgres-client";
import { prepareHistoricalTechnicalProposalOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-split-v2";
import { runHistoricalTechnicalProposalCliV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-execution-cli-v2";

export async function runHistoricalTechnicalProposalMainV2(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await runHistoricalTechnicalProposalCliV2(env,
    async (databaseUrl, input) => {
      const pool = postgres(databaseUrl, waiaCampaignPostgresDriverOptions());
      try { return await prepareHistoricalTechnicalProposalOnExecutionServerV2(pool, input); }
      finally { await pool.end({ timeout: 5 }); }
    });

  process.stdout.write(`${JSON.stringify({
    schemaVersion: "waia.trader.historical_technical_proposal_cli_result.v2",
    proposalId: result.id,
    proposalContentDigestHex: result.proposal.contentDigestHex,
  })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runHistoricalTechnicalProposalMainV2().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
