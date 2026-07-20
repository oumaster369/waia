/**
 * DEE-415 / HTR-WP15 — MKB read-model Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import { cleanupWp14Org } from "./wp14-forecast-decision-test-helpers";
import {
  cleanupWp15AllRows,
  cleanupWp15KnowledgeRows,
  queryWp15InMemoryReadModel,
  queryWp15PostgresReadModel,
  seedWp15KnowledgeRows,
  seedWp15User,
  WP15_PG_USER_A,
} from "./wp15-mkb-read-model-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader mkb read-model parity (DEE-415 / HTR-WP15)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp14Org(url!, WP15_PG_USER_A);
      orgA = await seedWp15User(url!, WP15_PG_USER_A, "WP15 MKB Read Model Parity");
    });

    beforeEach(async () => {
      await cleanupWp15AllRows(url!, orgA);
      await cleanupWp15KnowledgeRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp14Org(url!, WP15_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("returns tenant-scoped entries from postgres source", async () => {
      await seedWp15KnowledgeRows(orgA, "wp15-parity-run", "0");
      const result = await queryWp15PostgresReadModel(orgA, "wp15-parity-run");

      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.every((entry) => entry.organizationId === orgA)).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "forecast")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "market_prediction")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "market_event")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "knowledge_edge")).toBe(true);
    });

    it("matches in-memory semantic digest for the same seeded cycle", async () => {
      await seedWp15KnowledgeRows(orgA, "wp15-digest-run", "0");

      const postgresResult = await queryWp15PostgresReadModel(orgA, "wp15-digest-run");
      const memoryResult = await queryWp15InMemoryReadModel(orgA, "wp15-digest-run", "0");

      const postgresForecastStates = postgresResult.entries
        .filter((entry) => entry.subjectKind === "forecast")
        .map((entry) => entry.knowledgeState)
        .sort();
      const memoryForecastStates = memoryResult.entries
        .filter((entry) => entry.subjectKind === "forecast")
        .map((entry) => entry.knowledgeState)
        .sort();

      expect(postgresForecastStates).toEqual(memoryForecastStates);
      expect(postgresResult.verifiedKnowledge.length).toBe(memoryResult.verifiedKnowledge.length);
    });
  },
);
