// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildObservationConsumerEnvironment,
  parseObservationHostRuntimeV1,
} from "../../services/ai-trader-account-observation-host/entrypoint.mjs";
import { runAccountObservationCollector } from "../../scripts/trader/account-observation-collector-host";
import {
  ACCOUNT_OBSERVATION_FINANCIAL_MANIFEST_SCHEMA,
  accountObservationManifestDigest,
  parseAccountObservationAssignmentManifest,
} from "@/lib/trader/account-observation/assignment-manifest";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { MANIFEST_RELEASE_SHA, manifestAssignment, sealManifest } from "./account-observation-manifest-fixtures";

const MANIFEST_PATH = "/srv/waia/synthetic-observation-manifest.json";
const scope = { enabled: true as const, scopeId: "55555555-5555-4555-8555-555555555555",
  windowStartMs: 1000, windowEndMs: 2000, validFromMs: 3000, validUntilMs: 603000 };

function financialManifest() {
  const base = manifestAssignment({ leaseTtlMs: 180000 });
  const htxV5 = { enabled: true, expectedHtxUid: "123456", financialHistory: scope };
  const config = createObservationConfiguration({ symbols: base.symbols, pollIntervalMs: base.pollIntervalMs,
    maxBackoffMs: base.maxBackoffMs, readTimeoutMs: base.readTimeoutMs, leaseTtlMs: base.leaseTtlMs,
    htxCoverage: { ...base.readerLimits, host: "api.huobi.pro" }, htxV5 });
  return sealManifest({ schemaVersion: ACCOUNT_OBSERVATION_FINANCIAL_MANIFEST_SCHEMA,
    assignments: [{ ...base, htxV5, configurationRevision: config.revision }] });
}

function environment(digest: string) {
  return {
    WAIA_OBSERVATION_HOST_MODE: "account-observation-recurring",
    WAIA_DEPLOYMENT_TIER: "production", WAIA_IMAGE_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA, WAIA_OBSERVATION_OWNER_ID: "synthetic-observer",
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: MANIFEST_PATH,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: digest,
    WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: "postgres://waia_account_observer_login:synthetic@localhost:1/fixture",
    WAIA_OBSERVATION_READER_DATABASE_URL: "postgres://waia_account_observation_reader_login:synthetic@localhost:1/fixture",
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: "postgres://waia_account_observation_credential_login:synthetic@localhost:1/fixture",
    WAIA_OBSERVATION_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
  };
}

function host(text: string, digest: string, overrides = {}) {
  return parseObservationHostRuntimeV1({ ...environment(digest), ...overrides }, (requested: string) => {
    expect(requested).toBe(MANIFEST_PATH); return text;
  });
}

describe("observer supervisor financial manifest handoff", () => {
  it.each([false, true])("passes the declared v2=%s envelope to the authoritative collector parser", financial => {
    const fixture = financial ? financialManifest() : sealManifest();
    const config = host(fixture.text, fixture.digest);
    const child = buildObservationConsumerEnvironment(environment(fixture.digest), config);
    const trusted = parseAccountObservationAssignmentManifest(fixture.text, {
      expectedDigest: child.WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256,
      expectedReleaseSha: child.WAIA_RELEASE_SHA,
    });
    expect(trusted.configured[0]!.config.htxV5?.financialHistory).toEqual(financial ? scope : undefined);
    // Expired optional scope is structurally admitted; it must not disable base collection.
    expect(config.manifestSha256).toBe(fixture.digest);
  });

  it.each(["unknown-version", "v1-with-financial", "v2-without-financial", "assignments-not-array"])(
    "refuses an inconsistent %s envelope before spawning", kind => {
      const fixture = financialManifest(); const body = JSON.parse(fixture.text);
      if (kind === "unknown-version") body.schemaVersion = "waia.account_observation_assignment_manifest.v3";
      if (kind === "v1-with-financial") body.schemaVersion = "waia.account_observation_assignment_manifest.v1";
      if (kind === "v2-without-financial") delete body.assignments[0].htxV5.financialHistory;
      if (kind === "assignments-not-array") body.assignments = {};
      expect(() => host(JSON.stringify(body), fixture.digest)).toThrow(/REFUSED:MANIFEST_SCHEMA/);
    },
  );

  it.each(["scope-null", "scope-too-long", "stale-configuration", "unsealed-content"])(
    "keeps authoritative %s refusal before any collector resource opens", async kind => {
      const fixture = financialManifest(); const body = JSON.parse(fixture.text);
      delete body.contentSha256;
      if (kind === "scope-null") body.assignments[0].htxV5.financialHistory = null;
      if (kind === "scope-too-long") body.assignments[0].htxV5.financialHistory.validUntilMs++;
      if (kind === "stale-configuration") body.assignments[0].configurationRevision = "stale";
      if (kind === "unsealed-content") body.assignments[0].symbols = ["ETHUSDT"];
      const digest = kind === "unsealed-content" ? fixture.digest : accountObservationManifestDigest(body);
      const text = JSON.stringify({ ...body, contentSha256: digest });
      const config = host(text, digest);
      const open = vi.fn(async () => { throw new Error("UNEXPECTED_RESOURCE_OPEN"); });
      const fetchImpl = vi.fn<typeof fetch>();
      await expect(runAccountObservationCollector({
        env: buildObservationConsumerEnvironment(environment(digest), config),
        signal: new AbortController().signal, readManifest: () => text,
        openCollector: open, openReader: open, openCredentialService: open, fetchImpl,
      })).rejects.toThrow(/ACCOUNT_OBSERVATION_MANIFEST_REFUSED:/);
      expect(open).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("retains declared digest, manifest release and image release checks for v2", () => {
    const fixture = financialManifest();
    expect(() => host(fixture.text, "0".repeat(64))).toThrow(/REFUSED:MANIFEST_DECLARED_DIGEST/);
    const other = sealManifest({ ...fixture.body, releaseSha: "0".repeat(40) });
    expect(() => host(other.text, other.digest)).toThrow(/REFUSED:MANIFEST_RELEASE_SHA/);
    expect(() => host(fixture.text, fixture.digest, { WAIA_IMAGE_RELEASE_SHA: "0".repeat(40) }))
      .toThrow(/REFUSED:RELEASE_SHA_MISMATCH/);
    expect(() => host(fixture.text, fixture.digest, { HTX_SECRET_KEY: "synthetic-refused" }))
      .toThrow(/REFUSED:FORBIDDEN_RUNTIME_AUTHORITY/);
  });
});
