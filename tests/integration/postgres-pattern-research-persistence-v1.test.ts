/**
 * DEE-518 IC4 — pattern definition/occurrence Postgres roundtrip (opt-in).
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  assertPatternNotCapitalAuthority,
  buildPatternDefinitionRecord,
  buildPatternOccurrenceRecord,
  PatternDefinitionConflictError,
  PatternOccurrenceConflictError,
  PatternOccurrencePitViolationError,
  persistPatternDefinitionV1,
  persistPatternOccurrenceV1,
  readPatternDefinitionV1,
  readPatternOccurrenceV1,
} from "@/lib/trader/mi/pattern-research/pattern-research-persistence-v1";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_PATTERN_PG_USER = "00000000-0000-4000-8000-000000051805";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

async function cleanupPatternResearchRows(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  await sql.unsafe(
    `ALTER TABLE trader_pattern_occurrence_v1 DISABLE TRIGGER trader_pattern_occurrence_v1_block_delete`,
  );
  await sql.unsafe(
    `ALTER TABLE trader_pattern_definition_v1 DISABLE TRIGGER trader_pattern_definition_v1_block_delete`,
  );
  await sql.unsafe(`DELETE FROM trader_pattern_occurrence_v1 WHERE organization_id = $1`, [
    organizationId,
  ]);
  await sql.unsafe(`DELETE FROM trader_pattern_definition_v1 WHERE organization_id = $1`, [
    organizationId,
  ]);
  await sql.unsafe(
    `ALTER TABLE trader_pattern_occurrence_v1 ENABLE TRIGGER trader_pattern_occurrence_v1_block_delete`,
  );
  await sql.unsafe(
    `ALTER TABLE trader_pattern_definition_v1 ENABLE TRIGGER trader_pattern_definition_v1_block_delete`,
  );
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres pattern research persistence v1 (DEE-518 IC4)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP518_PATTERN_PG_USER);
      orgId = await seedWp13User(url!, WP518_PATTERN_PG_USER, "Pattern Research Persistence");
      sql = postgres(url!, { max: 1 });
    });

    beforeEach(async () => {
      await cleanupPatternResearchRows(sql, orgId);
    });

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupPatternResearchRows(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, WP518_PATTERN_PG_USER);
    });

    it("persists a definition and reads it back", async () => {
      const definitionRecord = buildPatternDefinitionRecord({
        organizationId: orgId,
        patternKey: "rv-level-slope-1",
        quantizerVersion: "quantizer/v1",
        stateVectorVersion: "state-vector/v1",
        ablationLevel: "level+slope",
        vTilde: [0.1, 0.2, 0.3],
        authoredBy: "dee-518-ic4-test",
      });

      const result = await persistPatternDefinitionV1(sql, definitionRecord);
      expect(result.insertedNew).toBe(true);

      const loaded = await readPatternDefinitionV1(sql, {
        organizationId: orgId,
        patternKey: definitionRecord.patternKey,
        definitionDigest: definitionRecord.definitionDigest,
      });
      expect(loaded).not.toBeNull();
      expect(loaded?.contentDigest).toBe(definitionRecord.contentDigest);
      expect(loaded?.authorityStatus).toBe("RESEARCH_ONLY");

      expect(() =>
        assertPatternNotCapitalAuthority({ authorityStatus: loaded!.authorityStatus }),
      ).not.toThrow();
    });

    it("persists an occurrence linked to a definition and is idempotent on exact duplicate", async () => {
      const definitionRecord = buildPatternDefinitionRecord({
        organizationId: orgId,
        patternKey: "rv-level-curvature-1",
        quantizerVersion: "quantizer/v1",
        stateVectorVersion: "state-vector/v1",
        ablationLevel: "level+curvature",
        vTilde: [0.4, 0.5, 0.6],
        authoredBy: "dee-518-ic4-test",
      });
      await persistPatternDefinitionV1(sql, definitionRecord);

      const occurrenceRecord = buildPatternOccurrenceRecord({
        organizationId: orgId,
        patternDefinitionId: definitionRecord.id,
        patternKey: definitionRecord.patternKey,
        patternDefinitionDigest: definitionRecord.definitionDigest,
        anchorClosedBarEpochMs: 1_700_000_000_000,
        symbol: "BTCUSDT",
        recurrenceCount: 12,
        transitionRowSums: [1, 1, 1],
        asOfEpochMs: 1_700_000_060_000,
      });

      const first = await persistPatternOccurrenceV1(sql, occurrenceRecord);
      const second = await persistPatternOccurrenceV1(sql, occurrenceRecord);
      expect(first.insertedNew).toBe(true);
      expect(second.insertedNew).toBe(false);
      expect(second.id).toBe(first.id);

      const loaded = await readPatternOccurrenceV1(sql, {
        organizationId: orgId,
        patternDefinitionId: definitionRecord.id,
        anchorClosedBarEpochMs: occurrenceRecord.anchorClosedBarEpochMs,
      });
      expect(loaded).not.toBeNull();
      expect(loaded?.contentDigest).toBe(occurrenceRecord.contentDigest);
    });

    it("rejects PIT-violating occurrences before they reach Postgres", () => {
      expect(() =>
        buildPatternOccurrenceRecord({
          organizationId: orgId,
          patternDefinitionId: "00000000-0000-4000-8000-000000000099",
          patternKey: "rv-level-1",
          patternDefinitionDigest: "d".repeat(64),
          anchorClosedBarEpochMs: 1_700_000_120_000,
          symbol: "BTCUSDT",
          recurrenceCount: 3,
          transitionRowSums: [1],
          asOfEpochMs: 1_700_000_000_000,
        }),
      ).toThrow(PatternOccurrencePitViolationError);
    });

    it("fails closed on definition natural-idempotent conflict (tampered content digest)", async () => {
      const definitionRecord = buildPatternDefinitionRecord({
        organizationId: orgId,
        patternKey: "rv-conflict-def",
        quantizerVersion: "quantizer/v1",
        stateVectorVersion: "state-vector/v1",
        ablationLevel: "level",
        vTilde: [0.7, 0.8],
        authoredBy: "dee-518-ic4-test",
      });
      await persistPatternDefinitionV1(sql, definitionRecord);

      const tampered = {
        ...definitionRecord,
        id: randomUUID(),
        contentDigest: "f".repeat(64),
      };
      await expect(persistPatternDefinitionV1(sql, tampered)).rejects.toThrow(
        PatternDefinitionConflictError,
      );
    });

    it("fails closed on occurrence natural-idempotent conflict (tampered content digest)", async () => {
      const definitionRecord = buildPatternDefinitionRecord({
        organizationId: orgId,
        patternKey: "rv-conflict-occ",
        quantizerVersion: "quantizer/v1",
        stateVectorVersion: "state-vector/v1",
        ablationLevel: "level",
        vTilde: [0.9, 1.0],
        authoredBy: "dee-518-ic4-test",
      });
      await persistPatternDefinitionV1(sql, definitionRecord);

      const occurrenceRecord = buildPatternOccurrenceRecord({
        organizationId: orgId,
        patternDefinitionId: definitionRecord.id,
        patternKey: definitionRecord.patternKey,
        patternDefinitionDigest: definitionRecord.definitionDigest,
        anchorClosedBarEpochMs: 1_700_000_180_000,
        symbol: "BTCUSDT",
        recurrenceCount: 5,
        transitionRowSums: [1],
        asOfEpochMs: 1_700_000_200_000,
      });
      await persistPatternOccurrenceV1(sql, occurrenceRecord);

      const tampered = {
        ...occurrenceRecord,
        id: randomUUID(),
        contentDigest: "e".repeat(64),
      };
      await expect(persistPatternOccurrenceV1(sql, tampered)).rejects.toThrow(
        PatternOccurrenceConflictError,
      );
    });

    it("rejects capital-authority claims regardless of authority_status", () => {
      expect(() =>
        assertPatternNotCapitalAuthority({
          authorityStatus: "RESEARCH_ONLY",
          claimsCapitalAuthority: true,
        }),
      ).toThrow(/cannot claim capital authority/);
      expect(() => assertPatternNotCapitalAuthority({ authorityStatus: "CAPITAL_LIVE" })).toThrow();
    });
  },
);
