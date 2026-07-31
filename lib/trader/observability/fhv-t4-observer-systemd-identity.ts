/**
 * DEE-436 — machine-derived waia-fhv-observer.service systemd identity.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  assertFhvT4BootIdEqual,
  normalizeFhvT4BootId,
} from "@/lib/trader/observability/fhv-t4-boot-id";
import { buildFhvT4RestrictedChildEnv } from "@/lib/trader/observability/fhv-t4-restricted-child-env";

export const FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION =
  "fhv-t4-observer-systemd-identity/v1" as const;

export type FhvT4ObserverSystemdIdentityV1 = Readonly<{
  schemaVersion: typeof FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION;
  unitName: string;
  bootId: string;
  invocationId: string;
  mainPid: number;
  activeEnterTimestampMonotonicUs: string;
  activeState: string;
}>;

export class FhvT4ObserverSystemdIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ObserverSystemdIdentityError";
  }
}

function parseObserverBootId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_BOOT_ID_INVALID",
      "bootId invalid.",
    );
  }
  try {
    return normalizeFhvT4BootId(raw);
  } catch {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_BOOT_ID_INVALID",
      "bootId invalid.",
    );
  }
}

export type FhvT4ObserverSystemdIdentityReader = (
  unitName?: string,
) => FhvT4ObserverSystemdIdentityV1;

let readerOverride: FhvT4ObserverSystemdIdentityReader | null = null;

export function setFhvT4ObserverSystemdIdentityReaderForTests(
  reader: FhvT4ObserverSystemdIdentityReader | null,
): void {
  readerOverride = reader;
}

export function parseFhvT4ObserverSystemdIdentity(raw: unknown): FhvT4ObserverSystemdIdentityV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_INVALID",
      "Observer systemd identity must be an object.",
    );
  }
  const identity = raw as FhvT4ObserverSystemdIdentityV1;
  if (identity.schemaVersion !== FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_SCHEMA_MISMATCH",
      "Observer identity schemaVersion mismatch.",
    );
  }
  if (!identity.unitName.trim()) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_UNIT_REQUIRED",
      "unitName is required.",
    );
  }
  const bootId = parseObserverBootId(identity.bootId);
  if (!identity.invocationId.trim()) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_INVOCATION_REQUIRED",
      "invocationId is required.",
    );
  }
  if (!Number.isInteger(identity.mainPid) || identity.mainPid <= 0) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_MAIN_PID_INVALID",
      "mainPid must be a positive integer.",
    );
  }
  if (!identity.activeEnterTimestampMonotonicUs.trim()) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_ACTIVE_ENTER_REQUIRED",
      "activeEnterTimestampMonotonicUs is required.",
    );
  }
  if (identity.activeState.trim() !== "active") {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_IDENTITY_NOT_ACTIVE",
      "Observer must be active for identity capture.",
    );
  }
  return {
    schemaVersion: identity.schemaVersion,
    unitName: identity.unitName.trim(),
    bootId,
    invocationId: identity.invocationId.trim(),
    mainPid: identity.mainPid,
    activeEnterTimestampMonotonicUs: identity.activeEnterTimestampMonotonicUs.trim(),
    activeState: identity.activeState.trim(),
  };
}

export function computeFhvT4ObserverSystemdIdentityDigest(
  identity: FhvT4ObserverSystemdIdentityV1,
): string {
  return computePayloadDigest(identity);
}

export function readFhvT4ObserverSystemdIdentity(
  repoRoot: string,
  unitName = "waia-fhv-observer.service",
  env: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ systemctlBin?: string; pythonBin?: string }>,
): FhvT4ObserverSystemdIdentityV1 {
  if (readerOverride) {
    return readerOverride(unitName);
  }
  const injected =
    (unitName.includes("campaign")
      ? env.FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON?.trim()
      : env.FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON?.trim()) ||
    env.FHV_T4_SYSTEMD_IDENTITY_JSON?.trim();
  if (injected) {
    const parsed = parseFhvT4ObserverSystemdIdentity(JSON.parse(injected));
    if (parsed.unitName !== unitName) {
      throw new FhvT4ObserverSystemdIdentityError(
        "FHV_T4_SYSTEMD_IDENTITY_UNIT_MISMATCH",
        `Injected systemd identity unit ${parsed.unitName} != ${unitName}`,
      );
    }
    return parsed;
  }
  const script = join(repoRoot, "scripts/ops/fhv-t4-observer-systemd-identity-read.sh");
  const systemctlBin = options?.systemctlBin?.trim() || env.FHV_SYSTEMCTL_BIN?.trim();
  const pythonBin = options?.pythonBin?.trim() || env.FHV_PYTHON_BIN?.trim();
  if (!systemctlBin?.startsWith("/") || !pythonBin?.startsWith("/")) {
    throw new FhvT4ObserverSystemdIdentityError(
      "CONTINUITY_IDENTITY_TOOL_BINDING_MISSING",
      "systemctlBin and pythonBin must be absolute executable paths.",
    );
  }
  const output = execFileSync(
    script,
    ["--systemctl-bin", systemctlBin, "--python-bin", pythonBin, unitName],
    { encoding: "utf8", env: buildFhvT4RestrictedChildEnv(env) },
  ).trim();
  return parseFhvT4ObserverSystemdIdentity(JSON.parse(output));
}

export const readFhvT4SystemdUnitIdentity = readFhvT4ObserverSystemdIdentity;

export function assertFhvT4ObserverRestartProven(input: {
  before: FhvT4ObserverSystemdIdentityV1;
  after: FhvT4ObserverSystemdIdentityV1;
}): void {
  if (input.before.unitName !== input.after.unitName) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_RESTART_UNIT_MISMATCH",
      "Observer unitName mismatch.",
    );
  }
  try {
    assertFhvT4BootIdEqual(input.before.bootId, input.after.bootId);
  } catch {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_RESTART_BOOT_ID_CHANGED",
      "Host reboot invalidates continuity proof.",
    );
  }
  if (input.before.invocationId === input.after.invocationId) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_RESTART_INVOCATION_UNCHANGED",
      "Observer InvocationID must change after restart.",
    );
  }
  if (
    input.before.mainPid === input.after.mainPid &&
    input.before.activeEnterTimestampMonotonicUs === input.after.activeEnterTimestampMonotonicUs
  ) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_RESTART_PROCESS_UNCHANGED",
      "Observer process/start identity must change after restart.",
    );
  }
  if (input.after.activeState !== "active") {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_OBSERVER_RESTART_NOT_ACTIVE",
      "Observer must be active after restart.",
    );
  }
}

export function assertFhvT4CampaignProcessUnchanged(input: {
  before: FhvT4ObserverSystemdIdentityV1;
  after: FhvT4ObserverSystemdIdentityV1;
}): void {
  if (input.before.unitName !== input.after.unitName) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_UNIT_MISMATCH",
      "Campaign unitName mismatch.",
    );
  }
  try {
    assertFhvT4BootIdEqual(input.before.bootId, input.after.bootId);
  } catch {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_BOOT_ID_CHANGED",
      "Host reboot invalidates campaign continuity proof.",
    );
  }
  if (input.before.invocationId !== input.after.invocationId) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_INVOCATION_CHANGED",
      "Campaign InvocationID must remain unchanged.",
    );
  }
  if (input.before.mainPid !== input.after.mainPid) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_PID_CHANGED",
      "Campaign MainPID must remain unchanged.",
    );
  }
  if (
    input.before.activeEnterTimestampMonotonicUs !== input.after.activeEnterTimestampMonotonicUs
  ) {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_ACTIVE_ENTER_CHANGED",
      "Campaign activation identity must remain unchanged.",
    );
  }
  if (input.after.activeState !== "active") {
    throw new FhvT4ObserverSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_NOT_ACTIVE",
      "Campaign must remain active.",
    );
  }
}
