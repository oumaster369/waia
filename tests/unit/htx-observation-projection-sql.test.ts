// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationDir = "db/migrations_postgres";
const v1Migration = readFileSync(
  `${migrationDir}/0229_trader_observation_read_only_credential_v1.sql`,
  "utf8",
);
const revisionGrantsMigration = readFileSync(
  `${migrationDir}/0230_trader_observation_consent_revision_grants_v1.sql`,
  "utf8",
);
const projectionMigration = readFileSync(
  `${migrationDir}/0231_trader_observation_purpose_projection_v1.sql`,
  "utf8",
);
const journal = JSON.parse(
  readFileSync(`${migrationDir}/meta/_journal.json`, "utf8"),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe("HTX observation-purpose SQL projection", () => {
  it("appends the production 0230 grant slot and a forward-only 0231 projection", () => {
    expect(revisionGrantsMigration).toContain(
      "GRANT SELECT (observation_revision)\n  ON public.exchange_credentials TO waia_account_observation_credential;",
    );
    expect(revisionGrantsMigration).toContain(
      "GRANT SELECT (configuration_revision)\n  ON public.trader_account_collection_state TO waia_account_observation_credential;",
    );
    expect(journal.entries.slice(-2).map(({ idx, when, tag }) => ({ idx, when, tag }))).toEqual([
      {
        idx: 230,
        when: 1780000000230,
        tag: "0230_trader_observation_consent_revision_grants_v1",
      },
      {
        idx: 231,
        when: 1780000000231,
        tag: "0231_trader_observation_purpose_projection_v1",
      },
    ]);
    expect(projectionMigration).toContain("CREATE FUNCTION public.exchange_credential_observation_read_permitted(");
    expect(projectionMigration).toContain("GENERATED ALWAYS AS (");
    expect(projectionMigration).toContain(") STORED NOT NULL;");
  });

  it("retains the immutable v1 predicate and grants only the new read boolean", () => {
    expect(v1Migration).toContain("CREATE FUNCTION public.exchange_credential_observation_read_only(");
    expect(v1Migration).toContain("IMMUTABLE");
    expect(v1Migration).toContain("ADD COLUMN observation_read_only boolean");
    expect(v1Migration).toContain("GRANT SELECT (observation_read_only)");
    expect(projectionMigration).toContain(
      "RETURN public.exchange_credential_observation_read_only(\n      metadata, expected_venue, expected_account\n    );",
    );
    expect(projectionMigration).toContain("GRANT SELECT (observation_read_permitted)");
    expect(projectionMigration).not.toMatch(/\b(?:DROP|REVOKE|UPDATE|DELETE|INSERT)\b/i);
  });

  it("accepts only exact canonical v2 observation records with actual read and optional unique trade scopes", () => {
    expect(projectionMigration).toContain("policy->'version' IS DISTINCT FROM '2'::jsonb");
    expect(projectionMigration).toContain("policy->'purpose' IS DISTINCT FROM '\"observation\"'::jsonb");
    expect(projectionMigration).toContain("key_name NOT IN (");
    expect(projectionMigration).toContain("policy->'exchangeAccountId' IS DISTINCT FROM to_jsonb(expected_account)");
    expect(projectionMigration).toContain("policy->'withdrawForbidden' IS DISTINCT FROM 'true'::jsonb");
    expect(projectionMigration).toContain("policy->'transferForbidden' IS DISTINCT FROM 'true'::jsonb");
    expect(projectionMigration).toContain("jsonb_typeof(policy->'warnings') IS DISTINCT FROM 'array'");
    expect(projectionMigration).toContain("jsonb_typeof(warning) IS DISTINCT FROM 'string'");
    expect(projectionMigration).toContain("jsonb_typeof(policy->'accountLabel') IS DISTINCT FROM 'string'");
    expect(projectionMigration).toContain("scope IS DISTINCT FROM '\"read\"'::jsonb");
    expect(projectionMigration).toContain("scope IS DISTINCT FROM '\"trade\"'::jsonb");
    expect(projectionMigration).toContain("count(DISTINCT value)");
    expect(projectionMigration).toContain("chr(9) || chr(10) || chr(11) || chr(12) || chr(13)");
    expect(projectionMigration).toContain("expected_account <> btrim(expected_account, trim_chars)");
  });

  it("fails closed for unknown versions or purposes and preserves actual scopes as metadata", () => {
    expect(projectionMigration).toContain("IF policy ? 'purpose' THEN\n      RETURN false;");
    expect(projectionMigration).toContain("OR policy->'purpose' IS DISTINCT FROM '\"observation\"'::jsonb");
    expect(projectionMigration).toContain("AND scope IS DISTINCT FROM '\"trade\"'::jsonb");
    expect(projectionMigration).not.toMatch(/UPDATE public\.exchange_credentials/i);
    expect(projectionMigration).not.toContain("observation_read_only =");
  });
});
