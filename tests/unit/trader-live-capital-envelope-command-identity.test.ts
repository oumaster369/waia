import { describe, expect, it } from "vitest";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  liveCapitalBasisBindingV2,
  liveCapitalEnvelopeCommandLimitV2,
  sealLiveCapitalEnvelopeV2,
  type LiveCapitalEnvelopeCommandV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import { advanceLiveCapitalEnvelopeStageV2 } from "@/lib/trader/risk/v2/live-capital-envelope-postgres";

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

describe("live capital envelope command limit", () => {
  it("does not consume the limit when the same commandId is already published or invalidated", () => {
    for (const prior of [
      { alreadyInvalidated: true, alreadyPublished: false },
      { alreadyInvalidated: false, alreadyPublished: true },
      { alreadyInvalidated: true, alreadyPublished: true },
    ]) {
      expect(
        liveCapitalEnvelopeCommandLimitV2({
          commandId: COMMAND,
          currentCommandId: COMMAND,
          refusalReason: "LIVE_CAPITAL_IDENTITY_CHANGED",
          ...prior,
        }),
      ).toEqual({
        commandId: COMMAND,
        consumeLimit: false,
        writeTerminal: false,
        clearOwnedCurrent: false,
        idempotentClosed: true,
      });
    }
  });

  it("does not freeze or clear a limit the command does not own", () => {
    expect(
      liveCapitalEnvelopeCommandLimitV2({
        commandId: COMMAND,
        currentCommandId: OTHER,
        alreadyInvalidated: false,
        alreadyPublished: false,
        refusalReason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      }),
    ).toEqual({
      commandId: COMMAND,
      consumeLimit: false,
      writeTerminal: false,
      clearOwnedCurrent: false,
      idempotentClosed: false,
    });
    expect(
      liveCapitalEnvelopeCommandLimitV2({
        commandId: COMMAND,
        currentCommandId: null,
        alreadyInvalidated: false,
        alreadyPublished: false,
        refusalReason: "SOURCE_METHOD_UNQUALIFIED",
      }).consumeLimit,
    ).toBe(false);
  });

  it("keeps expiry terminal without assigning the limit to another command", () => {
    expect(
      liveCapitalEnvelopeCommandLimitV2({
        commandId: COMMAND,
        currentCommandId: null,
        alreadyInvalidated: false,
        alreadyPublished: false,
        refusalReason: "LIVE_CAPITAL_ENVELOPE_STALE",
      }),
    ).toMatchObject({
      commandId: COMMAND,
      consumeLimit: false,
      writeTerminal: true,
      clearOwnedCurrent: false,
    });
    expect(
      liveCapitalEnvelopeCommandLimitV2({
        commandId: COMMAND,
        currentCommandId: COMMAND,
        alreadyInvalidated: false,
        alreadyPublished: false,
        refusalReason: "LIVE_CAPITAL_ENVELOPE_STALE",
      }),
    ).toMatchObject({ clearOwnedCurrent: true, consumeLimit: false, writeTerminal: true });
  });
});

type JournalRow = {
  stage: string;
  envelope_digest: string | null;
  basis_digest: string | null;
  reason: string | null;
};

function scriptedSql(input: {
  journal: JournalRow[];
  current: { command_id: string; envelope_digest: string } | null;
  envelopeBody?: string;
  publishedJournalBody?: string;
}) {
  const texts: string[] = [];
  const bound: unknown[][] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    texts.push(text);
    bound.push(values);
    if (text.includes("select stage")) return Promise.resolve(input.journal);
    if (text.includes("to_char")) return Promise.resolve([{ now: "2026-09-29T00:00:00.000Z" }]);
    if (text.includes("from trader_live_capital_envelopes_v2")) {
      return Promise.resolve(input.envelopeBody ? [{ body_text: input.envelopeBody }] : []);
    }
    if (text.includes("body_text") && text.includes("PUBLISHED")) {
      return Promise.resolve(
        input.publishedJournalBody ? [{ body_text: input.publishedJournalBody }] : [],
      );
    }
    if (text.includes("for update")) {
      return Promise.resolve(
        input.current
          ? [
              {
                command_id: input.current.command_id,
                envelope_digest: input.current.envelope_digest,
                policy_digest: POLICY,
                release_sha: RELEASE,
                basis_digest: "basis",
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
  return { sql, texts, bound };
}

const sealedStages: JournalRow[] = [
  { stage: "CAPTURED", envelope_digest: null, basis_digest: null, reason: null },
  { stage: "SEALED", envelope_digest: "ignored", basis_digest: null, reason: null },
];

describe("live capital envelope command identity", () => {
  it("does not spend or freeze the limit when the first command is refused", async () => {
    const { sql, texts, bound } = scriptedSql({ journal: sealedStages, current: null });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "ADMITTED",
      observed: {
        organizationId: ORG,
        accountId: command.accountId,
        policyDigest: "ef".repeat(32),
        releaseSha: RELEASE,
      },
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invalidated: false,
      allowanceId: null,
      orderId: null,
      venueEffects: "ZERO",
    });
    expect(bound.flat()).not.toContain("INVALIDATED");
    expect(bound.flat()).not.toContain("PUBLISHED");
    expect(texts.join("\n")).not.toContain("delete from trader_live_capital_envelope_current_v2");
    expect(texts.join("\n")).not.toContain("trader_live_capital_basis_bindings_v2");
  });

  it("does not clear another command's current envelope", async () => {
    const { sql, texts, bound } = scriptedSql({
      journal: sealedStages,
      current: { command_id: OTHER, envelope_digest: "ee".repeat(32) },
    });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "ADMITTED",
      observed: {
        organizationId: ORG,
        accountId: command.accountId,
        policyDigest: "ef".repeat(32),
        releaseSha: RELEASE,
      },
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invalidated: false,
    });
    expect(bound.flat()).not.toContain("INVALIDATED");
    expect(texts.join("\n")).not.toContain("delete from trader_live_capital_envelope_current_v2");
  });

  it("replays one published commandId without a second basis", async () => {
    const receipt = sealLiveCapitalEnvelopeV2(command);
    const { contentDigest, ...body } = receipt;
    const basis = liveCapitalBasisBindingV2(receipt);
    const { sql, texts, bound } = scriptedSql({
      journal: [
        ...sealedStages,
        { stage: "ADMITTED", envelope_digest: contentDigest, basis_digest: null, reason: null },
        {
          stage: "PUBLISHED",
          envelope_digest: contentDigest,
          basis_digest: basis.contentDigest,
          reason: null,
        },
      ],
      current: { command_id: COMMAND, envelope_digest: contentDigest },
      envelopeBody: canonicalJsonString(body),
      publishedJournalBody: canonicalJsonString({ sourceMethodQualified: true }),
    });
    const result = await advanceLiveCapitalEnvelopeStageV2(sql as never, {
      command,
      boundOrganizationId: ORG,
      stage: "PUBLISHED",
      observed: {
        organizationId: ORG,
        accountId: command.accountId,
        policyDigest: POLICY,
        releaseSha: RELEASE,
      },
      sourceMethodQualified: true,
    });
    expect(result).toMatchObject({
      decision: "PUBLISHED",
      replayed: true,
      envelopeDigest: contentDigest,
      basisDigest: basis.contentDigest,
      allowanceId: null,
      orderId: null,
      invalidated: false,
    });
    expect(texts.join("\n")).not.toContain("trader_live_capital_basis_bindings_v2");
    expect(texts.join("\n")).not.toContain("delete from trader_live_capital_envelope_current_v2");
    expect(bound.flat().filter((value) => value === "INVALIDATED")).toHaveLength(0);
    expect(bound.flat()).toContain(COMMAND);
  });
});
