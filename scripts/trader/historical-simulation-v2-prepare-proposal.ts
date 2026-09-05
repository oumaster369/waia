import postgres from "postgres";

import { waiaCampaignPostgresDriverOptions } from "../../db/postgres-client";
import { prepareHistoricalTechnicalProposalOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-split-v2";
import { runHistoricalTechnicalProposalCliV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-execution-cli-v2";

const result = await runHistoricalTechnicalProposalCliV2(process.env,
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
