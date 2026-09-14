import type { ScientificContainerSnapshotV1, ScientificProcessIdentityV1 } from "./scientific-process-verdict-v1";

type Projection = {
  containerId: string; startedAt: string; finishedAt: string; status: string;
  exitCode: number; oomKilled: boolean; restartCount: number;
};
const keys = ["containerId", "startedAt", "finishedAt", "status", "exitCode", "oomKilled", "restartCount"];
const states = ["running", "exited", "dead", "created", "paused", "restarting"] as const;
const emptyDockerTime = /^0001-01-01T00:00:00(?:\.0{1,9})?Z$/;
// Only call after timestamp validation; lexicographic UTC order retains nanoseconds.
function preciseTime(value: string): string {
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return `${seconds}.${fraction.padEnd(9, "0")}Z`;
}

/** Docker UTC timestamps may have nanoseconds. Validate calendar fields before truncation. */
export function normalizeScientificDockerTimestampV1(value: unknown): string | null {
  if (typeof value !== "string" || emptyDockerTime.test(value)) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  const millis = Date.parse(normalized);
  return Number.isFinite(millis) && new Date(millis).toISOString() === normalized ? normalized : null;
}

/** Pure adapter, no Docker/SSH/DB calls. Input must be an allowlisted projection,
 * never full inspect/config/env. Caller independently establishes org/run/release/attempt
 * ownership and read time; this parser does not authenticate that association.
 * Preserve exact raw StartedAt comparison before millisecond normalization so two
 * invocations within one millisecond cannot alias. Any restart requires investigation.
 */
export function scientificContainerObservationV1(
  raw: unknown,
  context: Readonly<{ identity: ScientificProcessIdentityV1; exactDockerStartedAt: string; observedAt: string }>,
): ScientificContainerSnapshotV1 | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const values = raw as Record<string, unknown>;
  if (Object.keys(values).length !== keys.length || !keys.every(key =>
    Object.getOwnPropertyDescriptor(values, key)?.get === undefined &&
    Object.prototype.hasOwnProperty.call(values, key))) return null;
  const projected = values as Projection;
  if (typeof projected.containerId !== "string" || !/^[a-f0-9]{64}$/.test(projected.containerId) ||
      projected.containerId !== context.identity.containerId ||
      typeof projected.startedAt !== "string" || projected.startedAt !== context.exactDockerStartedAt ||
      !states.includes(projected.status as typeof states[number]) ||
      !Number.isSafeInteger(projected.exitCode) || projected.exitCode < 0 || projected.exitCode > 255 ||
      typeof projected.oomKilled !== "boolean" || projected.restartCount !== 0) return null;
  const startedAt = normalizeScientificDockerTimestampV1(projected.startedAt);
  const observedAt = normalizeScientificDockerTimestampV1(context.observedAt);
  if (!startedAt || startedAt !== context.identity.containerStartedAt ||
      !observedAt || observedAt !== context.observedAt || observedAt < startedAt) return null;
  const terminal = projected.status === "exited" || projected.status === "dead";
  const finishedAt = normalizeScientificDockerTimestampV1(projected.finishedAt);
  if (terminal ? !finishedAt || finishedAt < startedAt || finishedAt > observedAt :
    typeof projected.finishedAt !== "string" || !emptyDockerTime.test(projected.finishedAt) ||
    projected.oomKilled || projected.exitCode !== 0) return null;
  if (terminal && (preciseTime(projected.finishedAt) < preciseTime(projected.startedAt) ||
    preciseTime(projected.finishedAt) > preciseTime(context.observedAt))) return null;
  return Object.freeze({ identity: Object.freeze({ ...context.identity }), observedAt,
    state: projected.status as ScientificContainerSnapshotV1["state"],
    exitCode: terminal ? projected.exitCode : null, finishedAt: terminal ? finishedAt : null,
    oomKilled: projected.oomKilled,
    // Docker ExitCode 128+n alone is not proof that signal n caused termination.
    signal: null });
}
