import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResearchDatasetRecord } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import type { SealedResearchDatasetDigests } from "@/lib/trader/market-data/research-dataset";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-000000000398";
const DATASET_NAME = "m9-dataset-preflight-test";

const BASE_SEALED: SealedResearchDatasetDigests = {
  trainBarCount: 60,
  validationBarCount: 20,
  blindBarCount: 20,
  trainDigest: "train-digest-a",
  validationDigest: "validation-digest-a",
  blindDigest: "blind-digest-a",
  sealedAt: "2026-01-01T00:00:00.000Z",
};

function buildExistingRecord(
  overrides: Partial<ResearchDatasetRecord> = {},
): ResearchDatasetRecord {
  return {
    id: "00000000-0000-4000-8000-000000000399",
    organizationId: ORG_A,
    name: DATASET_NAME,
    symbol: "BTC/USDT",
    interval: "1m",
    trainBarCount: BASE_SEALED.trainBarCount,
    validationBarCount: BASE_SEALED.validationBarCount,
    blindBarCount: BASE_SEALED.blindBarCount,
    trainDigest: BASE_SEALED.trainDigest,
    validationDigest: BASE_SEALED.validationDigest,
    blindDigest: BASE_SEALED.blindDigest,
    sealedAt: new Date("2026-01-01T00:00:00.000Z"),
    metadataJson: "{}",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const getResearchDatasetByNamePostgres = vi.fn();
const insertResearchDatasetPostgres = vi.fn();

vi.mock("@/lib/trader/market-data/research-dataset-repository-postgres", () => ({
  getResearchDatasetByNamePostgres: (...args: unknown[]) =>
    getResearchDatasetByNamePostgres(...args),
  insertResearchDatasetPostgres: (...args: unknown[]) => insertResearchDatasetPostgres(...args),
}));

describe("M9 dataset preflight decision (DEE-398 / ADR-0022)", () => {
  it("CREATE: no existing dataset for org + name", async () => {
    const { decideM9DatasetPreflight } = await import("@/lib/trader/research/m9-dataset-preflight");
    const decision = decideM9DatasetPreflight(
      null,
      { symbol: "BTC/USDT", interval: "1m", sealed: BASE_SEALED },
      { organizationId: ORG_A, datasetName: DATASET_NAME },
    );
    expect(decision.kind).toBe("create");
  });

  it("REUSE: existing dataset has matching digests and counts", async () => {
    const { decideM9DatasetPreflight } = await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    const decision = decideM9DatasetPreflight(
      existing,
      { symbol: "BTC/USDT", interval: "1m", sealed: BASE_SEALED },
      { organizationId: ORG_A, datasetName: DATASET_NAME },
    );
    expect(decision.kind).toBe("reuse");
    if (decision.kind === "reuse") {
      expect(decision.existing.id).toBe(existing.id);
    }
  });

  it("CONFLICT: same org + name but different blindDigest fails closed", async () => {
    const { decideM9DatasetPreflight, M9DatasetContentConflictError } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    expect(() =>
      decideM9DatasetPreflight(
        existing,
        {
          symbol: "BTC/USDT",
          interval: "1m",
          sealed: { ...BASE_SEALED, blindDigest: "blind-digest-b" },
        },
        { organizationId: ORG_A, datasetName: DATASET_NAME },
      ),
    ).toThrow(M9DatasetContentConflictError);
  });

  it("CONFLICT: same org + name but different bar counts fails closed", async () => {
    const { decideM9DatasetPreflight, M9DatasetContentConflictError } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    expect(() =>
      decideM9DatasetPreflight(
        existing,
        {
          symbol: "BTC/USDT",
          interval: "1m",
          sealed: { ...BASE_SEALED, trainBarCount: BASE_SEALED.trainBarCount + 1 },
        },
        { organizationId: ORG_A, datasetName: DATASET_NAME },
      ),
    ).toThrow(M9DatasetContentConflictError);
  });

  it("conflict error carries the existing dataset id and fail-closed code", async () => {
    const { decideM9DatasetPreflight, M9DatasetContentConflictError } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    try {
      decideM9DatasetPreflight(
        existing,
        {
          symbol: "BTC/USDT",
          interval: "1m",
          sealed: { ...BASE_SEALED, validationDigest: "different" },
        },
        { organizationId: ORG_A, datasetName: DATASET_NAME },
      );
      expect.unreachable("expected M9DatasetContentConflictError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(M9DatasetContentConflictError);
      expect((error as InstanceType<typeof M9DatasetContentConflictError>).code).toBe(
        "M9_DATASET_CONTENT_CONFLICT",
      );
      expect((error as InstanceType<typeof M9DatasetContentConflictError>).existingDatasetId).toBe(
        existing.id,
      );
    }
  });
});

describe("resolveM9ResearchDatasetPostgres (DEE-398 / ADR-0022)", () => {
  const context = requireOrgContext(ORG_A);

  beforeEach(() => {
    getResearchDatasetByNamePostgres.mockReset();
    insertResearchDatasetPostgres.mockReset();
  });

  it("creates a new dataset row when none exists", async () => {
    const { resolveM9ResearchDatasetPostgres } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const created = buildExistingRecord({ id: "00000000-0000-4000-8000-000000000400" });
    getResearchDatasetByNamePostgres.mockResolvedValue(null);
    insertResearchDatasetPostgres.mockResolvedValue(created);

    const result = await resolveM9ResearchDatasetPostgres({} as never, context, {
      id: created.id,
      name: DATASET_NAME,
      symbol: "BTC/USDT",
      interval: "1m",
      sealed: BASE_SEALED,
    });

    expect(result.decision).toBe("create");
    expect(result.dataset.id).toBe(created.id);
    expect(insertResearchDatasetPostgres).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing dataset with matching content — no insert call", async () => {
    const { resolveM9ResearchDatasetPostgres } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    getResearchDatasetByNamePostgres.mockResolvedValue(existing);

    const result = await resolveM9ResearchDatasetPostgres({} as never, context, {
      id: "00000000-0000-4000-8000-000000000401",
      name: DATASET_NAME,
      symbol: "BTC/USDT",
      interval: "1m",
      sealed: BASE_SEALED,
    });

    expect(result.decision).toBe("reuse");
    expect(result.dataset.id).toBe(existing.id);
    expect(insertResearchDatasetPostgres).not.toHaveBeenCalled();
  });

  it("throws M9DatasetContentConflictError and never inserts on divergent content", async () => {
    const { resolveM9ResearchDatasetPostgres, M9DatasetContentConflictError } =
      await import("@/lib/trader/research/m9-dataset-preflight");
    const existing = buildExistingRecord();
    getResearchDatasetByNamePostgres.mockResolvedValue(existing);

    await expect(
      resolveM9ResearchDatasetPostgres({} as never, context, {
        id: "00000000-0000-4000-8000-000000000402",
        name: DATASET_NAME,
        symbol: "BTC/USDT",
        interval: "1m",
        sealed: { ...BASE_SEALED, blindDigest: "blind-digest-divergent" },
      }),
    ).rejects.toBeInstanceOf(M9DatasetContentConflictError);
    expect(insertResearchDatasetPostgres).not.toHaveBeenCalled();
  });
});
