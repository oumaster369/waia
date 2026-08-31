import postgres from "postgres";
import { parseHistoricalSimulationProductionCliEnvV2 } from
  "../../lib/trader/historical-simulation-v2/production-runner-cli-config-v2";
import { runHistoricalSimulationProductionLoopV2 } from
  "../../lib/trader/historical-simulation-v2/production-runner-v2";

const config = parseHistoricalSimulationProductionCliEnvV2(process.env);
const sql = postgres(config.databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 15 });
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop); process.once("SIGINT", stop);
try {
  const result = await runHistoricalSimulationProductionLoopV2({ sql, organizationId: config.organizationId,
    accountId: config.accountId, runId: config.runId, partition: config.partition, symbol: config.symbol,
    initialCycleSequence: config.initialCycleSequence,
    terminalCycleSequenceExclusive: config.terminalCycleSequenceExclusive }, { signal: controller.signal,
    onProgress: (progress) => process.stdout.write(`${JSON.stringify({
      schemaVersion: "waia.trader.historical_simulation_runner_progress.v2", ...progress })}\n`) });
  process.stdout.write(`${JSON.stringify({ schemaVersion: "waia.trader.historical_simulation_runner_result.v2", ...result })}\n`);
} finally {
  process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
  await sql.end({ timeout: 5 });
}
