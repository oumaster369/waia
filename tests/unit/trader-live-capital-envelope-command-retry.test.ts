import { describe, expect, it } from "vitest";

import {
  advanceLiveCapitalEnvelopeStageV2,
  type LiveCapitalObservedIdentityV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-postgres";
import type { LiveCapitalEnvelopeCommandV2 } from "@/lib/trader/risk/v2/live-capital-envelope-v2";

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
}) {
  const bound: unknown[][] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    bound.push(values);
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
  { stage: "SEALED", envelope_digest: "ignored", basis_digest: null, reason: null },
  { stage: "ADMITTED", envelope_digest: "ignored", basis_digest: null, reason: null },
];

describe("live capital envelope command retry", () => {
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
