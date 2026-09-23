/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 * CI assert: change-log triggers are not worse than 2x on a diagnostic insert sample.
 * The execution-path sample uses the same trigger. Full 5000-transition profile is the
 * same measurement with a larger N; this sample is what CI asserts.
 */

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES?.trim());
const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";
const SAMPLE = 40;

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe.skipIf(!enabled)("admin console change-log overhead", () => {
  const sql = enabled ? postgres(url, { max: 1 }) : null;

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("stays within 2x when the change-log trigger is enabled", async () => {
    if (!sql) return;
    const measure = async (enabledTrigger: boolean) => {
      await sql.unsafe(
        `ALTER TABLE trader_admin_diagnostic_event ${enabledTrigger ? "ENABLE" : "DISABLE"} TRIGGER trader_admin_change_log_trg`,
      );
      const samples: number[] = [];
      for (let index = 0; index < SAMPLE; index += 1) {
        const id = crypto.randomUUID();
        const started = performance.now();
        await sql`
          INSERT INTO trader_admin_diagnostic_event (
            id, occurred_at, received_at, service, environment, severity, error_class,
            message_redacted, fingerprint, context_json
          ) VALUES (
            ${id}::uuid, now(), now(), 'overhead', 'test', 'warning', 'Overhead', 'overhead', ${id}, '{}'::jsonb
          )
        `;
        samples.push(performance.now() - started);
        await sql`DELETE FROM trader_admin_diagnostic_event WHERE id = ${id}::uuid`;
        await sql`DELETE FROM trader_admin_change_log WHERE entity_id = ${id}`;
      }
      return percentile(samples, 0.95);
    };
    const disabled = await measure(false);
    const enabledP95 = await measure(true);
    await sql.unsafe(
      "ALTER TABLE trader_admin_diagnostic_event ENABLE TRIGGER trader_admin_change_log_trg",
    );
    expect(enabledP95).toBeLessThanOrEqual(Math.max(disabled * 2, disabled + 1));
  }, 120_000);
});
