import { sql, type SQL } from "drizzle-orm";

/**
 * `all` and `history` are filter sentinels, not `order_execution_mode` values.
 * Compare the mode as text so Postgres never casts the parameter to that enum.
 */
export function orderVisibleInMode(mode: string, qualified: boolean): SQL {
  const runId = qualified ? sql`o.historical_run_id` : sql`historical_run_id`;
  const executionMode = qualified ? sql`o.execution_mode` : sql`execution_mode`;
  return sql`(
    ${mode}::text = 'all'
    OR (${mode}::text = 'history' AND ${runId} IS NOT NULL)
    OR (
      ${mode}::text IN ('live', 'paper', 'mock')
      AND ${runId} IS NULL
      AND ${executionMode}::text = ${mode}::text
    )
  )`;
}
