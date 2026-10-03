import { describe, expect, it } from "vitest";

import {
  advanceLiveCapitalEnvelopeStageV2,
  type LiveCapitalObservedIdentityV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-postgres";
import { sealLiveCapitalEnvelopeV2, type LiveCapitalEnvelopeCommandV2 } from "@/lib/trader/risk/v2/live-capital-envelope-v2";

const ORG = "00000000-0000-4000-8000-000000114501";
const COMMAND = "00000000-0000-4000-8000-000000114502";
const OTHER = "00000000-0000-4000-8000-000000114503";
const POLICY = "ab".repeat(32);
const RELEASE = "cd".repeat(32);

const command: LiveCapitalEnvelopeCommandV2 = {
  commandId: COMMAND,
  organizationId: ORG,
  accountId: "synthetic-envelope-account",
  policyDigest: POLICY,
  releaseSha: RELEASE,
  capitalNotional: "10",
  lossLimitNotional: "1",
  validFromUtc: "2020-01-01T00:00:00.000Z",
  validUntilUtc: "2099-01-01T00:00:00.000Z",
};

function observed(
  patch: Partial<LiveCapitalObservedIdentityV2> = {},
): LiveCapitalObservedIdentityV2 {
  return {
    organizationId: ORG,
    accountId: command.accountId,
    policyDigest: POLICY,
    releaseSha: RELEASE,
    ...patch,
  };
}

type JournalRow = {
  stage: string;
  envelope_digest: string | null;
  basis_digest: string | null;
  reason: string | null;
};

function scriptedSql(input: {
  journal: JournalRow[];
  current: { command_id: string; envelope_digest: string } | null;
  storedCommand?: LiveCapitalEnvelopeCommandV2;
  onFirstQuery?: () => void;
}) {
  const bound: unknown[][] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (bound.length === 0) input.onFirstQuery?.();
    const text = strings.join(" ");
    bound.push(values);
    if (text.includes("select body_text") && input.storedCommand) {
      const { contentDigest: _digest, ...body } = sealLiveCapitalEnvelopeV2(input.storedCommand);
      void _digest;
      return Promise.resolve([{ body_text: JSON.stringify(body) }]);
    }
    if (text.includes("select stage")) return Promise.resolve(input.journal);
    if (text.includes("to_char")) return Promise.resolve([{ now: "2026-09-29T00:00:00.000Z" }]);
    if (text.includes("for update")) {
      return Promise.resolve(
        input.current
          ? [
              {
                command_id: input.current.command_id,
                envelope_digest: input.current.envelope_digest,
                policy_digest: POLICY,
                release_sha: RELEASE,
                basis_digest: null,
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tx, {
    begin: (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx),
  });
  return { sql, bound };
}

const priorStages: JournalRow[] = [
  { stage: "CAPTURED", envelope_digest: null, basis_digest: null, reason: null },
  { stage: "SEALED", envelope_digest: sealLiveCapitalEnvelopeV2(command).contentDigest, basis_digest: null, reason: null },
  { stage: "ADMITTED", envelope_digest: sealLiveCapitalEnvelopeV2(command).contentDigest, basis_digest: null, reason: null },
];

describe("live capital envelope command retry", () => {
  it.each([
    { capitalNotional: "20" },
    { lossLimitNotional: "2" },
    { policyDigest: "ef".repeat(32) },
    { validUntilUtc: "2098-01-01T00:00:00.000Z" },
  ])("rejects reused command ID with changed payload %j without SQL writes", async patch => {
    const digest = sealLiveCapitalEnvelopeV2(command).contentDigest;
    const { sql, bound } = scriptedSql({
      journal: [...priorStages, { stage: "PUBLISHED", envelope_digest: digest,
        basis_digest: "ab".repeat(32), reason: null }],
      current: { command_id: COMMAND, envelope_digest: digest },
      storedCommand: command,
    });
    await expect(advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command: { ...command, ...patch }, boundOrganizationId: ORG,
      stage: "CAPTURED", observed: observed(), sourceMethodQualified: true,
    })).rejects.toThrow("ENVELOPE_COMMAND_CONFLICT");
    expect(bound.flat()).not.toContain("INVALIDATED");
  });

  it("refuses a legacy captured-only command whose original payload is unknown", async () => {
    const { sql } = scriptedSql({ journal: [priorStages[0]!], current: null });
    await expect(advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command, boundOrganizationId: ORG, stage: "SEALED", observed: observed(),
    })).rejects.toThrow("ENVELOPE_COMMAND_IDENTITY_UNAVAILABLE");
  });

  it("rejects a runtime-unknown stage before beginning a transaction", async () => {
    const { sql, bound } = scriptedSql({ journal: [], current: null });
    await expect(advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command, boundOrganizationId: ORG, stage: "TYPO" as never, observed: observed(),
    })).rejects.toThrow("ENVELOPE_STAGE_INVALID");
    expect(bound).toHaveLength(0);
  });

  it("does not accept a qualification flag changed after the first await", async () => {
    const request = { command, boundOrganizationId: ORG, stage: "ADMITTED" as const,
      observed: observed(), sourceMethodQualified: false };
    const { sql, bound } = scriptedSql({ journal: priorStages.slice(0, 2), current: null,
      onFirstQuery: () => { request.sourceMethodQualified = true; } });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, request);
    expect(result).toMatchObject({ decision: "REFUSED", reason: "SOURCE_METHOD_UNQUALIFIED" });
    expect(bound.flat()).not.toContain("ADMITTED");
  });

  it("uses the observed identity captured before an asynchronous stage", async () => {
    const mutableObserved = { ...observed() };
    const { sql } = scriptedSql({ journal: priorStages.slice(0, 2), current: null,
      onFirstQuery: () => { mutableObserved.policyDigest = "ef".repeat(32); } });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command, boundOrganizationId: ORG, stage: "ADMITTED", observed: mutableObserved,
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({ decision: "REFUSED", reason: "ADMITTED", invalidated: false });
  });

  it("snapshots the command before an awaited stage can mutate its payload", async () => {
    const mutableCommand = { ...command };
    const { sql, bound } = scriptedSql({ journal: [{ ...priorStages[0]!,
      envelope_digest: sealLiveCapitalEnvelopeV2(command).contentDigest }], current: null,
      onFirstQuery: () => { mutableCommand.capitalNotional = "20"; } });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command: mutableCommand, boundOrganizationId: ORG, stage: "SEALED", observed: observed(),
    });
    expect(result).toMatchObject({ decision: "REFUSED", reason: "SEALED" });
    expect(bound.flat()).not.toContain("20");
    expect(bound.flat()).toContain("10");
  });

  it("allows exact legacy SEALED retries with a known original digest", async () => {
    const { sql, bound } = scriptedSql({ journal: priorStages.slice(0, 2), current: null });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command, boundOrganizationId: ORG, stage: "SEALED", observed: observed(),
    });
    expect(result).toMatchObject({ decision: "REFUSED", reason: "STAGE_ALREADY_COMMITTED", replayed: true });
    expect(bound.flat()).not.toContain("INVALIDATED");
  });

  it("publishes the same command after invalidation once the observed identity matches", async () => {
    const { sql, bound } = scriptedSql({
      journal: [
        ...priorStages,
        {
          stage: "INVALIDATED",
          envelope_digest: null,
          basis_digest: null,
          reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
        },
      ],
      current: null,
    });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "PUBLISHED",
      observed: observed(),
      sourceMethodQualified: true,
    });
    expect(result.decision).toBe("PUBLISHED");
    expect(result.allowanceId).toBeNull();
    expect(result.orderId).toBeNull();
    const values = bound.flat();
    expect(values).toContain("PUBLISHED");
    expect(values.filter((value) => value === "INVALIDATED")).toHaveLength(0);
  });

  it("does not insert a second INVALIDATED row when the same command is still refused", async () => {
    const { sql, bound } = scriptedSql({
      journal: [
        ...priorStages,
        {
          stage: "INVALIDATED",
          envelope_digest: null,
          basis_digest: null,
          reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
        },
      ],
      current: null,
    });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "PUBLISHED",
      observed: observed({ policyDigest: "ef".repeat(32) }),
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invalidated: true,
      allowanceId: null,
      orderId: null,
    });
    expect(bound.flat().filter((value) => value === "INVALIDATED")).toHaveLength(0);
  });

  it("writes a terminal journal row for the command that loses the current envelope", async () => {
    const { sql, bound } = scriptedSql({
      journal: priorStages.slice(0, 2),
      current: { command_id: OTHER, envelope_digest: "ee".repeat(32) },
    });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "ADMITTED",
      observed: observed(),
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({
      decision: "REFUSED",
      reason: "OVERLAPPING_AUTHORITY",
      invalidated: false,
      allowanceId: null,
      orderId: null,
      venueEffects: "ZERO",
    });
    const values = bound.flat();
    expect(values).toContain("INVALIDATED");
    expect(values).toContain("OVERLAPPING_AUTHORITY");
  });
});
