import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { htxObservationReaderLimitsSchema } from "./coverage";
import { createObservationConfiguration } from "./runtime";
import type { ConfiguredHtxObservationAssignment } from "./configured-runtime";

export const ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA =
  "waia.account_observation_assignment_manifest.v1";
/** Bounded before parsing so an oversized file cannot be walked at all. */
export const ACCOUNT_OBSERVATION_MANIFEST_MAX_BYTES = 65536;

export type AccountObservationManifestRefusal =
  | "SIZE"
  | "JSON"
  | "SCHEMA"
  | "CONTENT_DIGEST"
  | "EXPECTED_DIGEST"
  | "RELEASE_SHA"
  | "CONFIGURATION_REVISION"
  | "COVERAGE"
  | "LEASE_TTL"
  | "DUPLICATE_ACCOUNT"
  | "DUPLICATE_CREDENTIAL";

function refuse(code: AccountObservationManifestRefusal): never {
  throw new Error(`ACCOUNT_OBSERVATION_MANIFEST_REFUSED:${code}`);
}

const assignmentSchema = z
  .object({
    organizationId: z.string().uuid(),
    credentialId: z.string().uuid(),
    exchangeAccountId: z.string().regex(/^[1-9]\d{0,39}$/),
    credentialRevision: z
      .string()
      .max(256)
      .regex(/^[1-9]\d*$/),
    configurationRevision: z.string().min(1).max(256),
    symbols: z
      .array(z.string().regex(/^[A-Z0-9]{2,32}$/))
      .min(1)
      .max(32),
    pollIntervalMs: z.number().int().min(1000).max(86400000),
    maxBackoffMs: z.number().int().min(1000).max(86400000),
    readTimeoutMs: z.number().int().min(100).max(60000),
    leaseTtlMs: z.number().int().min(1000).max(3600000),
    readerLimits: htxObservationReaderLimitsSchema,
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA),
    releaseSha: z.string().regex(/^[0-9a-f]{40}$/),
    host: z.enum(["api.huobi.pro", "api-aws.huobi.pro"]),
    intervalMs: z.number().int().min(1000).max(86400000),
    iterationTimeoutMs: z.number().int().min(100).max(3600000),
    openTimeoutMs: z.number().int().min(100).max(60000),
    shutdownTimeoutMs: z.number().int().min(100).max(60000),
    assignments: z.array(assignmentSchema).min(1).max(20),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type AccountObservationAssignmentManifest = Readonly<z.infer<typeof manifestSchema>>;

export type TrustedAccountObservationAssignments = Readonly<{
  digest: string;
  releaseSha: string;
  host: "api.huobi.pro" | "api-aws.huobi.pro";
  intervalMs: number;
  iterationTimeoutMs: number;
  openTimeoutMs: number;
  shutdownTimeoutMs: number;
  configured: readonly ConfiguredHtxObservationAssignment[];
}>;

/** Key-sorted JSON so a reformatted or reordered file keeps one identity. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Content identity of everything except the declared digest itself. */
export function accountObservationManifestDigest(
  manifest: Omit<AccountObservationAssignmentManifest, "contentSha256">,
): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

/** Trusted operator input only: an exact release, an exact declared digest and an exact
 * independently supplied expected digest must all agree before anything opens. This narrows
 * an already approved operator decision; it never discovers accounts, never accepts request
 * or browser input, and manufactures neither database currentness nor venue admission.
 * The merged assignment source still re-checks every binding against live database state.
 */
export function parseAccountObservationAssignmentManifest(
  text: string,
  expected: Readonly<{ expectedDigest: string; expectedReleaseSha: string }>,
): TrustedAccountObservationAssignments {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > ACCOUNT_OBSERVATION_MANIFEST_MAX_BYTES
  ) {
    refuse("SIZE");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse("JSON");
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) refuse("SCHEMA");
  const { contentSha256, ...body } = parsed.data;
  const digest = accountObservationManifestDigest(body);
  if (digest !== contentSha256) refuse("CONTENT_DIGEST");
  if (!/^[0-9a-f]{64}$/.test(expected.expectedDigest) || digest !== expected.expectedDigest) {
    refuse("EXPECTED_DIGEST");
  }
  if (
    !/^[0-9a-f]{40}$/.test(expected.expectedReleaseSha) ||
    body.releaseSha !== expected.expectedReleaseSha
  ) {
    refuse("RELEASE_SHA");
  }

  const accounts = new Set<string>();
  const credentials = new Set<string>();
  const configured = body.assignments.map((item) => {
    const account = JSON.stringify([item.organizationId, item.exchangeAccountId]);
    if (accounts.has(account)) refuse("DUPLICATE_ACCOUNT");
    if (credentials.has(item.credentialId)) refuse("DUPLICATE_CREDENTIAL");
    accounts.add(account);
    credentials.add(item.credentialId);
    const readerLimits = Object.freeze({ ...item.readerLimits });
    let config;
    try {
      config = createObservationConfiguration({
        symbols: item.symbols,
        pollIntervalMs: item.pollIntervalMs,
        maxBackoffMs: item.maxBackoffMs,
        readTimeoutMs: item.readTimeoutMs,
        leaseTtlMs: item.leaseTtlMs,
        htxCoverage: { ...readerLimits, host: body.host },
      });
    } catch {
      refuse("COVERAGE");
    }
    if (item.configurationRevision !== config.revision) refuse("CONFIGURATION_REVISION");
    if (config.leaseTtlMs > body.iterationTimeoutMs) refuse("LEASE_TTL");
    return Object.freeze({
      binding: Object.freeze({
        organizationId: item.organizationId,
        credentialId: item.credentialId,
        exchangeAccountId: item.exchangeAccountId,
        credentialRevision: item.credentialRevision,
        configurationRevision: config.revision,
      }),
      config,
      readerLimits,
    });
  });

  return Object.freeze({
    digest,
    releaseSha: body.releaseSha,
    host: body.host,
    intervalMs: body.intervalMs,
    iterationTimeoutMs: body.iterationTimeoutMs,
    openTimeoutMs: body.openTimeoutMs,
    shutdownTimeoutMs: body.shutdownTimeoutMs,
    configured: Object.freeze(configured),
  });
}
