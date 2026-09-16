import {
  ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA,
  accountObservationManifestDigest,
  type AccountObservationAssignmentManifest,
} from "@/lib/trader/account-observation/assignment-manifest";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";

export const MANIFEST_RELEASE_SHA = "1eaa73cd134e1bc104b0f4fefa4e1e5c9f08e801";
export const ORGANIZATION_A = "11111111-1111-4111-8111-111111111111";
export const ORGANIZATION_B = "22222222-2222-4222-8222-222222222222";
export const CREDENTIAL_A = "33333333-3333-4333-8333-333333333333";
export const CREDENTIAL_B = "44444444-4444-4444-8444-444444444444";
export const ACCOUNT_A = "12345678";
export const ACCOUNT_B = "87654321";

export type ManifestReaderLimits = {
  pageSize: number;
  maxPages: number;
  maxRecords: number;
  maxResponseBytes: number;
  tradeWindowMs: number;
};

export const READER_LIMITS: ManifestReaderLimits = {
  pageSize: 100,
  maxPages: 2,
  maxRecords: 200,
  maxResponseBytes: 262144,
  tradeWindowMs: 86400000,
};

export type ManifestAssignment = {
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
  credentialRevision: string;
  configurationRevision: string;
  symbols: string[];
  pollIntervalMs: number;
  maxBackoffMs: number;
  readTimeoutMs: number;
  leaseTtlMs: number;
  readerLimits: ManifestReaderLimits;
};

export type ManifestBody = Omit<AccountObservationAssignmentManifest, "contentSha256">;

/** Revision is derived exactly the way production configuration derives it, so a mutated
 * fixture cannot accidentally remain self-consistent. */
export function manifestAssignment(
  overrides: Partial<ManifestAssignment> = {},
  host: ManifestBody["host"] = "api.huobi.pro",
): ManifestAssignment {
  const base = {
    organizationId: ORGANIZATION_A,
    credentialId: CREDENTIAL_A,
    exchangeAccountId: ACCOUNT_A,
    credentialRevision: "1",
    symbols: ["BTCUSDT"],
    pollIntervalMs: 60000,
    maxBackoffMs: 300000,
    readTimeoutMs: 10000,
    leaseTtlMs: 120000,
    readerLimits: READER_LIMITS,
    ...overrides,
  };
  const configurationRevision =
    overrides.configurationRevision ??
    createObservationConfiguration({
      symbols: base.symbols,
      pollIntervalMs: base.pollIntervalMs,
      maxBackoffMs: base.maxBackoffMs,
      readTimeoutMs: base.readTimeoutMs,
      leaseTtlMs: base.leaseTtlMs,
      htxCoverage: { ...base.readerLimits, host },
    }).revision;
  return { ...base, configurationRevision };
}

export function manifestBody(overrides: Partial<ManifestBody> = {}): ManifestBody {
  return {
    schemaVersion: ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA,
    releaseSha: MANIFEST_RELEASE_SHA,
    host: "api.huobi.pro",
    intervalMs: 60000,
    iterationTimeoutMs: 300000,
    openTimeoutMs: 15000,
    shutdownTimeoutMs: 10000,
    assignments: [manifestAssignment()],
    ...overrides,
  } as ManifestBody;
}

/** A manifest as an operator would seal it: body plus its own exact content digest. */
export function sealManifest(overrides: Partial<ManifestBody> = {}): {
  text: string;
  digest: string;
  body: ManifestBody;
} {
  const body = manifestBody(overrides);
  const digest = accountObservationManifestDigest(body);
  return { text: JSON.stringify({ ...body, contentSha256: digest }), digest, body };
}
