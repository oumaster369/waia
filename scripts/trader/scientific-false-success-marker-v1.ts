import { createHash } from "node:crypto";
import {
  reconcileScientificProcessVerdictV1,
  type ScientificContainerSnapshotV1,
  type ScientificProcessIdentityV1,
  type ScientificProcessVerdictV1,
} from "./scientific-process-verdict-v1";

/** Recorded host forensic identities. Marker and log remain on the host; this module
 * never overwrites them. Tests use the exact marker bytes plus log size/digest metadata.
 */
export const RECORDED_90DE233A_FALSE_SUCCESS_FORENSICS_V1 = Object.freeze({
  schemaVersion: "waia.trader.scientific_false_success_forensics.v1" as const,
  attemptPath: "/opt/waia/90de233a-proposal-attempt-01",
  markerRelpath: "exit-status",
  markerBytes: Object.freeze([0x30, 0x0a]) as readonly number[],
  markerSha256Hex: "9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa",
  logRelpath: "stdout-stderr.log",
  logByteLength: 935405,
  logSha256Hex: "235e885e9e228f8cdc0177500a2512255fb83f824af5155212f141b80fdcd66d",
  launchStartedRelpath: "launch.started",
  launchStartedSha256Hex: "803eb3587473d71b544e677493da968309a3dbd792264f8fe88a29d3030f0a37",
  containerFinishedAt: "2026-09-12T04:43:00.377Z",
  containerExitCode: 1,
  dockerRestartCount: 0,
});

const SHA256 = /^[0-9a-f]{64}$/;

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyScientificExitMarkerV1(
  bytes: unknown,
): "ZERO_MARKER" | "NONZERO_MARKER" | "INVALID_MARKER" {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16) return "INVALID_MARKER";
  const text = bytes.toString("utf8");
  if (!/^(0|[1-9][0-9]{0,2})\n$/.test(text)) return "INVALID_MARKER";
  const code = Number(text.slice(0, -1));
  if (!Number.isSafeInteger(code) || code < 0 || code > 255) return "INVALID_MARKER";
  return code === 0 ? "ZERO_MARKER" : "NONZERO_MARKER";
}

export type ScientificProcessSupersessionInputV1 = Readonly<{
  identity: ScientificProcessIdentityV1;
  recordedAt: string;
  markerBytes: Buffer;
  logByteLength: number;
  logSha256Hex: string;
  launchStartedPresent: boolean;
  /** True only when the caller is requesting a new launch. Existing exclusive
   * launch.started must then refuse rather than start a second process. */
  attemptNewStart: boolean;
  attachExitCode: number | null;
  container: ScientificContainerSnapshotV1 | null;
  evidenceVerified: boolean;
  proposalContentDigestHex: string | null;
}>;

export type ScientificProcessSupersessionV1 = Readonly<{
  schemaVersion: "waia.trader.scientific_process_supersession.v1";
  kind: "APPEND_ONLY_AUTHORITATIVE_CONTAINER_RESULT";
  markerClassification: ReturnType<typeof classifyScientificExitMarkerV1>;
  markerSha256Hex: string;
  logByteLength: number;
  logSha256Hex: string;
  launchStartedPresent: boolean;
  duplicateStartRefused: boolean;
  attachExitCode: number | null;
  containerExitCode: number | null;
  authoritativeProcess: ScientificProcessVerdictV1["process"];
  verdict: ScientificProcessVerdictV1["verdict"];
  issues: ScientificProcessVerdictV1["issues"];
  authorityGranted: false;
  overwritesMarker: false;
}>;

/** Append-only supersession: the filesystem marker is evidence of a wrapper claim,
 * never of SUCCESS. Existing marker bytes are hashed, not rewritten.
 */
export function appendScientificProcessSupersessionV1(
  input: ScientificProcessSupersessionInputV1,
  existing: readonly ScientificProcessSupersessionV1[] = [],
): ScientificProcessSupersessionV1 {
  if (existing.length > 0) {
    const last = existing[existing.length - 1]!;
    if (last.schemaVersion !== "waia.trader.scientific_process_supersession.v1") {
      throw new Error("SUPERSESSION_CORRUPT");
    }
  }
  const markerClassification = classifyScientificExitMarkerV1(input.markerBytes);
  const markerSha256Hex = Buffer.isBuffer(input.markerBytes)
    ? digest(input.markerBytes)
    : "0".repeat(64);
  const logOk =
    Number.isSafeInteger(input.logByteLength) &&
    input.logByteLength >= 0 &&
    SHA256.test(input.logSha256Hex);
  const wrapperExit = input.attachExitCode;
  const verdict = reconcileScientificProcessVerdictV1({
    expectedIdentity: input.identity,
    now: input.recordedAt,
    maxObservationAgeMs: 3_600_000,
    container: input.container,
    wrapper:
      wrapperExit === null
        ? null
        : {
            identity: input.identity,
            observedAt: input.recordedAt,
            exitCode: wrapperExit,
          },
    evidence:
      input.evidenceVerified && input.proposalContentDigestHex
        ? {
            identity: input.identity,
            observedAt: input.recordedAt,
            status: "VERIFIED",
            proposalContentDigestHex: input.proposalContentDigestHex,
          }
        : { identity: input.identity, observedAt: input.recordedAt, status: "ABSENT" },
  });
  const duplicateStartRefused = input.attemptNewStart && input.launchStartedPresent;
  const record: ScientificProcessSupersessionV1 = Object.freeze({
    schemaVersion: "waia.trader.scientific_process_supersession.v1",
    kind: "APPEND_ONLY_AUTHORITATIVE_CONTAINER_RESULT",
    markerClassification,
    markerSha256Hex,
    logByteLength: logOk ? input.logByteLength : -1,
    logSha256Hex: logOk ? input.logSha256Hex : "0".repeat(64),
    launchStartedPresent: input.launchStartedPresent,
    duplicateStartRefused,
    attachExitCode: wrapperExit,
    containerExitCode: input.container?.exitCode ?? null,
    authoritativeProcess: verdict.process,
    verdict: duplicateStartRefused ? "UNKNOWN" : verdict.verdict,
    issues: verdict.issues,
    authorityGranted: false,
    overwritesMarker: false,
  });
  return record;
}
