import { describe, expect, it } from "vitest";
import {
  ACCOUNT_OBSERVATION_MANIFEST_MAX_BYTES,
  parseAccountObservationAssignmentManifest,
} from "@/lib/trader/account-observation/assignment-manifest";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CREDENTIAL_A,
  CREDENTIAL_B,
  MANIFEST_RELEASE_SHA as RELEASE_SHA,
  ORGANIZATION_A,
  ORGANIZATION_B,
  READER_LIMITS,
  manifestAssignment as assignment,
  sealManifest as sealed,
  type ManifestAssignment as Assignment,
  type ManifestBody as Body,
} from "./account-observation-manifest-fixtures";

function parse(text: string, digest: string, releaseSha = RELEASE_SHA) {
  return parseAccountObservationAssignmentManifest(text, {
    expectedDigest: digest,
    expectedReleaseSha: releaseSha,
  });
}

describe("account observation trusted assignment manifest", () => {
  it("accepts an exact operator manifest and yields configured assignments", () => {
    const { text, digest } = sealed();
    const trusted = parse(text, digest);

    expect(trusted.digest).toBe(digest);
    expect(trusted.releaseSha).toBe(RELEASE_SHA);
    expect(trusted.host).toBe("api.huobi.pro");
    expect(trusted.configured).toHaveLength(1);
    const [only] = trusted.configured;
    expect(only.binding).toEqual({
      organizationId: ORGANIZATION_A,
      credentialId: CREDENTIAL_A,
      exchangeAccountId: ACCOUNT_A,
      credentialRevision: "1",
      configurationRevision: only.config.revision,
    });
    expect(only.config.symbols).toEqual(["BTCUSDT"]);
    expect(only.config.htxCoverage).toEqual({ ...READER_LIMITS, host: "api.huobi.pro" });
    expect(Object.isFrozen(trusted.configured)).toBe(true);
    expect(Object.isFrozen(only.binding)).toBe(true);
  });

  it("is content-identified independently of key order and whitespace", () => {
    const { text, digest } = sealed();
    const reordered = JSON.parse(text) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());

    expect(parse(JSON.stringify(shuffled, null, 4), digest).digest).toBe(digest);
  });

  it("refuses an oversized file before parsing", () => {
    const { digest } = sealed();
    const oversized = " ".repeat(ACCOUNT_OBSERVATION_MANIFEST_MAX_BYTES + 1);

    expect(() => parse(oversized, digest)).toThrow(/REFUSED:SIZE/);
  });

  it("refuses malformed JSON and non-string input", () => {
    const { digest } = sealed();

    expect(() => parse("{ not json", digest)).toThrow(/REFUSED:JSON/);
    expect(() => parse(undefined as unknown as string, digest)).toThrow(/REFUSED:SIZE/);
  });

  it("refuses unknown fields, wrong schema version and an unsupported host", () => {
    const { text, digest } = sealed();
    const extra = JSON.stringify({ ...JSON.parse(text), attacker: "extra" });
    expect(() => parse(extra, digest)).toThrow(/REFUSED:SCHEMA/);

    const wrongSchema = sealed({ schemaVersion: "waia.something_else.v1" } as unknown as Partial<Body>);
    expect(() => parse(wrongSchema.text, wrongSchema.digest)).toThrow(/REFUSED:SCHEMA/);

    const badHost = sealed({ host: "api.example.com" } as unknown as Partial<Body>);
    expect(() => parse(badHost.text, badHost.digest)).toThrow(/REFUSED:SCHEMA/);
  });

  it("refuses credential substitution after sealing", () => {
    const { text, digest } = sealed();
    const tampered = JSON.parse(text) as { assignments: Assignment[] };
    tampered.assignments[0].credentialId = CREDENTIAL_B;

    expect(() => parse(JSON.stringify(tampered), digest)).toThrow(/REFUSED:CONTENT_DIGEST/);
  });

  it("refuses account substitution after sealing", () => {
    const { text, digest } = sealed();
    const tampered = JSON.parse(text) as { assignments: Assignment[] };
    tampered.assignments[0].exchangeAccountId = ACCOUNT_B;

    expect(() => parse(JSON.stringify(tampered), digest)).toThrow(/REFUSED:CONTENT_DIGEST/);
  });

  it("refuses organization substitution after sealing", () => {
    const { text, digest } = sealed();
    const tampered = JSON.parse(text) as { assignments: Assignment[] };
    tampered.assignments[0].organizationId = ORGANIZATION_B;

    expect(() => parse(JSON.stringify(tampered), digest)).toThrow(/REFUSED:CONTENT_DIGEST/);
  });

  it("refuses a resealed manifest whose expected digest was not independently supplied", () => {
    const substituted = sealed({
      assignments: [assignment({ credentialId: CREDENTIAL_B, exchangeAccountId: ACCOUNT_B })],
    });
    const original = sealed();

    // Internally consistent, but not the digest the operator approved.
    expect(() => parse(substituted.text, original.digest)).toThrow(/REFUSED:EXPECTED_DIGEST/);
    expect(() => parse(substituted.text, "not-a-digest")).toThrow(/REFUSED:EXPECTED_DIGEST/);
  });

  it("refuses a manifest sealed for a different release", () => {
    const other = "0".repeat(40);
    const { text, digest } = sealed({ releaseSha: other });

    expect(() => parse(text, digest, RELEASE_SHA)).toThrow(/REFUSED:RELEASE_SHA/);
    expect(() => parse(text, digest, "short")).toThrow(/REFUSED:RELEASE_SHA/);
  });

  it("refuses a stale configuration revision", () => {
    const stale = sealed({
      assignments: [assignment({ configurationRevision: "sha256:" + "a".repeat(64) })],
    });

    expect(() => parse(stale.text, stale.digest)).toThrow(/REFUSED:CONFIGURATION_REVISION/);
  });

  it("refuses a symbol mutation that keeps the previous revision", () => {
    const revision = assignment().configurationRevision;
    const mutated = sealed({
      assignments: [
        assignment({ symbols: ["BTCUSDT", "ETHUSDT"], configurationRevision: revision }),
      ],
    });

    expect(() => parse(mutated.text, mutated.digest)).toThrow(/REFUSED:CONFIGURATION_REVISION/);
  });

  it("refuses a coverage mutation that keeps the previous revision", () => {
    const revision = assignment().configurationRevision;
    const mutated = sealed({
      assignments: [
        assignment({
          readerLimits: { ...READER_LIMITS, maxPages: 5 },
          configurationRevision: revision,
        }),
      ],
    });

    expect(() => parse(mutated.text, mutated.digest)).toThrow(/REFUSED:CONFIGURATION_REVISION/);
  });

  it("refuses coverage outside the transport envelope", () => {
    const outOfRange = sealed({
      assignments: [
        assignment({
          readerLimits: { ...READER_LIMITS, maxPages: 99 },
          configurationRevision: "sha256:" + "b".repeat(64),
        }),
      ],
    });

    expect(() => parse(outOfRange.text, outOfRange.digest)).toThrow(/REFUSED:SCHEMA/);
  });

  it("refuses a lease that outlives the iteration budget", () => {
    const overrun = sealed({
      iterationTimeoutMs: 100000,
      assignments: [assignment({ leaseTtlMs: 200000 })],
    });

    expect(() => parse(overrun.text, overrun.digest)).toThrow(/REFUSED:LEASE_TTL/);
  });

  it("refuses a duplicate account assignment", () => {
    const duplicate = sealed({
      assignments: [assignment(), assignment({ credentialId: CREDENTIAL_B })],
    });

    expect(() => parse(duplicate.text, duplicate.digest)).toThrow(/REFUSED:DUPLICATE_ACCOUNT/);
  });

  it("refuses one credential shared across two accounts", () => {
    const shared = sealed({
      assignments: [assignment(), assignment({ exchangeAccountId: ACCOUNT_B })],
    });

    expect(() => parse(shared.text, shared.digest)).toThrow(/REFUSED:DUPLICATE_CREDENTIAL/);
  });

  it("refuses an empty assignment list, so there is no implicit all-organizations mode", () => {
    const empty = sealed({ assignments: [] });

    expect(() => parse(empty.text, empty.digest)).toThrow(/REFUSED:SCHEMA/);
  });

  it("bounds the assignment list", () => {
    const many = Array.from({ length: 21 }, (_, index) =>
      assignment({
        exchangeAccountId: String(10000000 + index),
        credentialId: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
      }),
    );
    const oversized = sealed({ assignments: many });

    expect(() => parse(oversized.text, oversized.digest)).toThrow(/REFUSED:SCHEMA/);
  });
});
