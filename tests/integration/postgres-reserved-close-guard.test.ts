import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.WAIA_TEST_POSTGRES_SESSION_CLOSE_URL;

describe.skipIf(!databaseUrl)("actual reserved backend disconnect", () => {
  it.each(["0", "1s"])("retains controlled results for session idle limit %s", limit => {
    const parsed = new URL(databaseUrl!);
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(parsed.hostname);
    // Only synthetic local databases; never accept a production connection.
    expect(parsed.pathname).toMatch(/^\/waia_(?:hsv2_it_|test)/);
    const code = `
      import {createRequire} from 'node:module';
      const load = createRequire(process.cwd() + '/package.json');
      const postgres = load('postgres');
      const {require: tsRequire} = load('tsx/cjs/api');
      const from = process.cwd() + '/local-close-guard-test.cjs';
      const {guardSingleConnectionPostgresPool} = tsRequire('./db/postgres-reserved-close-guard.ts', from);
      const {waiaCampaignPostgresDriverOptions} = tsRequire('./db/postgres-client.ts', from);
      const {bindPostgresReservedSession, withPostgresSessionTransaction} = tsRequire('./db/postgres-session-transaction.ts', from);
      const log = event => process.stdout.write(JSON.stringify(event) + '\\n');
      const pool = guardSingleConnectionPostgresPool(postgres(process.env.WAIA_TEST_POSTGRES_SESSION_CLOSE_URL, {
        ...waiaCampaignPostgresDriverOptions(),
        connection: {idle_in_transaction_session_timeout: ${JSON.stringify(limit)}},
        onclose: () => log({event:'closed'}),
      }));
      let reserved;
      try {
        reserved = await pool.reserve();
        const bound = bindPostgresReservedSession(pool, reserved);
        await withPostgresSessionTransaction(bound, 'SERIALIZABLE', async tx => {
          const [row] = await tx\`SELECT current_setting('idle_in_transaction_session_timeout') AS idle\`;
          log({event:'opened', idle:row.idle});
          const [jsonRow] = await tx\`SELECT \${tx.json({guard:['ok'], nested:{n:1}})}::jsonb AS value\`;
          if (JSON.stringify(jsonRow.value) !== JSON.stringify({guard:['ok'], nested:{n:1}})) throw Error('JSON_BINDING_CHANGED');
          const delayed = tx.unsafe('SELECT 1 AS n').values();
          await new Promise(resolve => setTimeout(resolve, 1500));
          await delayed;
          log({event:'query-completed'});
        });
        log({event:'committed'});
      } catch (error) {
        const flatten = e => e instanceof AggregateError ? e.errors.flatMap(flatten) : [e.code];
        log({event:'controlled-failure', codes:flatten(error)});
        process.exitCode = 1;
      } finally {
        reserved?.release();
        await pool.end({timeout:2});
        log({event:'cleanup-completed'});
      }
    `;
    const child = spawnSync(process.execPath,
      ["--import", "tsx", "--conditions=react-server", "--input-type=module", "-e", code], {
        cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
        env: { PATH: process.env.PATH, NODE_ENV: "test", WAIA_TRADER_CLI: "1",
          WAIA_TEST_POSTGRES_SESSION_CLOSE_URL: databaseUrl },
      });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.stdout.trim(), child.stderr).not.toBe("");
    expect(child.stderr).not.toMatch(/TypeError|Cannot read properties of null/);
    const events = child.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(events.some(row => row.event === "opened" && row.idle === limit)).toBe(true);
    expect(events.at(-1)?.event).toBe("cleanup-completed");
    if (limit === "0") {
      expect(child.status).toBe(0);
      expect(events.some(row => row.event === "committed")).toBe(true);
    } else {
      expect(child.status).toBe(1);
      expect(events.some(row => row.event === "closed")).toBe(true);
      expect(events.some(row => row.event === "committed" || row.event === "query-completed")).toBe(false);
      expect(events.find(row => row.event === "controlled-failure")?.codes)
        .toEqual(["CONNECTION_CLOSED", "CONNECTION_CLOSED"]);
    }
  }, 15_000);
});
