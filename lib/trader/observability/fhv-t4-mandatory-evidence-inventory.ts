/**
 * DEE-436 — canonical mandatory T4A evidence inventory builder.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { resolveFhvSystemdDeployedRevisionPath } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import { resolveFhvOperatorStatusPath } from "@/lib/trader/observability/fhv-status-writer";
import {
  FHV_T4_CAMPAIGN_RUNTIME_FILENAME,
  FHV_T4_CAMPAIGN_RUNTIME_START_FILENAME,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
  resolveFhvT4ContinuityVerificationProofPath,
  type FhvT4ContinuitySnapshotV1,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { resolveFhvT4DeploymentProofPath } from "@/lib/trader/observability/fhv-t4-deployment-proof";
import { FHV_T4_PAUSE_ARMED_FILENAME } from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { resolveFhvT4HostProbeProofPathForPhase } from "@/lib/trader/observability/fhv-t4-host-probe-proof";
import {
  resolveFhvT4ObserverQualificationPostRestartPath,
  resolveFhvT4ObserverQualificationPreCampaignPath,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import {
  resolveFhvT4FinalProofPath,
  resolveFhvT4PausedProofPath,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import { resolveFhvT4CheckoutIdentityPath } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import { resolveFhvT4RollbackProofPath } from "@/lib/trader/observability/fhv-t4-rollback-proof";

export const FHV_T4_MANDATORY_EVIDENCE_INVENTORY_SCHEMA_VERSION =
  "fhv-t4-mandatory-evidence-inventory/v2" as const;

export type FhvT4MandatoryEvidenceEntry = Readonly<{
  absolutePath: string;
  relativePath: string;
  category: string;
}>;

export class FhvT4MandatoryEvidenceInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4MandatoryEvidenceInventoryError";
  }
}

function realpathStrict(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_REALPATH_FAILED",
      `Unable to realpath evidence path: ${path}`,
    );
  }
}

function assertInsideRoot(abs: string, root: string, label: string): void {
  const realAbs = realpathStrict(abs);
  const realRoot = realpathStrict(root);
  const rel = relative(realRoot, realAbs).split(sep).join("/");
  if (rel.startsWith("..") || rel === "") {
    // empty means same path as root which is not a file
    if (realAbs === realRoot) {
      throw new FhvT4MandatoryEvidenceInventoryError(
        "FHV_T4_INV_PATH_IS_ROOT",
        `${label} path must be a file under ${root}`,
      );
    }
  }
  if (rel.startsWith("..")) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_PATH_ESCAPE",
      `${label} path escapes approved root ${root}: ${abs}`,
    );
  }
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    const linkTarget = realpathStrict(abs);
    const linkRel = relative(realRoot, linkTarget).split(sep).join("/");
    if (linkRel.startsWith("..")) {
      throw new FhvT4MandatoryEvidenceInventoryError(
        "FHV_T4_INV_SYMLINK_ESCAPE",
        `${label} symlink escapes approved root: ${abs}`,
      );
    }
  }
  if (!statSync(abs).isFile()) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_NOT_FILE",
      `${label} must be a regular file: ${abs}`,
    );
  }
}

function requireExisting(path: string, code: string): void {
  if (!existsSync(path)) {
    throw new FhvT4MandatoryEvidenceInventoryError(code, `Mandatory evidence missing: ${path}`);
  }
}

export function buildFhvT4MandatoryEvidenceInventory(input: {
  runRoot: string;
  repoRoot: string;
  renderedUnitsDir: string;
  continuityBeforePath: string;
  continuityAfterPath: string;
  hostProbeJsonPath: string;
  postRollbackHostProbeJsonPath: string;
}): readonly FhvT4MandatoryEvidenceEntry[] {
  const runRoot = resolve(input.runRoot);
  const repoRoot = resolve(input.repoRoot);
  const renderedUnitsDir = resolve(input.renderedUnitsDir);
  const hostProbePath = resolve(input.hostProbeJsonPath);
  const postRollbackHostProbePath = resolve(input.postRollbackHostProbeJsonPath);
  const continuityBefore = resolve(input.continuityBeforePath);
  const continuityAfter = resolve(input.continuityAfterPath);

  const namespaces = {
    "run-root": runRoot,
    "repo-proof": repoRoot,
    "rendered-units": renderedUnitsDir,
    "host-proof": resolve(runRoot, "control"),
  } as const;

  type Planned = {
    abs: string;
    namespace: keyof typeof namespaces;
    category: string;
    code: string;
  };

  const planned: Planned[] = [
    {
      abs: resolveFhvT4CheckoutIdentityPath(runRoot),
      namespace: "run-root",
      category: "checkout-identity",
      code: "FHV_T4_INV_CHECKOUT",
    },
    {
      abs: join(runRoot, "fhv-rehearsal-manifest.v1.json"),
      namespace: "run-root",
      category: "manifest",
      code: "FHV_T4_INV_MANIFEST",
    },
    {
      abs: join(runRoot, "control", FHV_T4_PAUSE_ARMED_FILENAME),
      namespace: "run-root",
      category: "pause-armed",
      code: "FHV_T4_INV_PAUSE_ARMED",
    },
    {
      abs: join(runRoot, "control/command-ledger.jsonl"),
      namespace: "run-root",
      category: "command-ledger",
      code: "FHV_T4_INV_LEDGER",
    },
    {
      abs: resolveFhvT4PausedProofPath(runRoot),
      namespace: "run-root",
      category: "paused-proof",
      code: "FHV_T4_INV_PAUSED_PROOF",
    },
    {
      abs: join(runRoot, "fhv-rehearsal-terminal.v1.json"),
      namespace: "run-root",
      category: "terminal",
      code: "FHV_T4_INV_TERMINAL",
    },
    {
      abs: join(runRoot, "replay-checkpoint.json"),
      namespace: "run-root",
      category: "checkpoint",
      code: "FHV_T4_INV_CHECKPOINT",
    },
    {
      abs: join(runRoot, "fhv-resume-runtime-proof.v1.json"),
      namespace: "run-root",
      category: "resume-proof",
      code: "FHV_T4_INV_RESUME",
    },
    {
      abs: resolveFhvT4FinalProofPath(runRoot),
      namespace: "run-root",
      category: "final-proof",
      code: "FHV_T4_INV_FINAL_PROOF",
    },
    {
      abs: join(runRoot, "run-chain.json"),
      namespace: "run-root",
      category: "run-chain",
      code: "FHV_T4_INV_RUN_CHAIN",
    },
    {
      abs: join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_START_FILENAME),
      namespace: "run-root",
      category: "campaign-runtime-start",
      code: "FHV_T4_INV_RUNTIME_START",
    },
    {
      abs: join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_FILENAME),
      namespace: "run-root",
      category: "campaign-runtime",
      code: "FHV_T4_INV_RUNTIME",
    },
    {
      abs: join(runRoot, "fhv-rehearsal-campaign-progress.v1.json"),
      namespace: "run-root",
      category: "progress",
      code: "FHV_T4_INV_PROGRESS",
    },
    {
      abs: resolveFhvOperatorStatusPath(runRoot),
      namespace: "run-root",
      category: "alert-policy",
      code: "FHV_T4_INV_STATUS",
    },
    {
      abs: join(renderedUnitsDir, "waia-fhv-campaign.service"),
      namespace: "rendered-units",
      category: "rendered-unit",
      code: "FHV_T4_INV_RENDERED_CAMPAIGN",
    },
    {
      abs: join(renderedUnitsDir, "waia-fhv-observer.service"),
      namespace: "rendered-units",
      category: "rendered-unit",
      code: "FHV_T4_INV_RENDERED_OBSERVER",
    },
    {
      abs: resolveFhvT4DeploymentProofPath(runRoot),
      namespace: "run-root",
      category: "deployment-proof",
      code: "FHV_T4_INV_DEPLOY_PROOF",
    },
    {
      abs: continuityBefore,
      namespace: "run-root",
      category: "continuity-before",
      code: "FHV_T4_INV_CONT_BEFORE",
    },
    {
      abs: continuityAfter,
      namespace: "run-root",
      category: "continuity-after",
      code: "FHV_T4_INV_CONT_AFTER",
    },
    {
      abs: resolveFhvT4ContinuityVerificationProofPath(runRoot),
      namespace: "run-root",
      category: "continuity-verification",
      code: "FHV_T4_INV_CONT_VERIFY",
    },
    {
      abs: resolveFhvT4ObserverQualificationPreCampaignPath(runRoot),
      namespace: "run-root",
      category: "observer-qualification-pre",
      code: "FHV_T4_INV_OBSERVER_QUAL_PRE",
    },
    {
      abs: resolveFhvT4ObserverQualificationPostRestartPath(runRoot),
      namespace: "run-root",
      category: "observer-qualification-post",
      code: "FHV_T4_INV_OBSERVER_QUAL_POST",
    },
    {
      abs: resolveFhvT4RollbackProofPath(runRoot),
      namespace: "run-root",
      category: "rollback-proof",
      code: "FHV_T4_INV_ROLLBACK_PROOF",
    },
    {
      abs: resolveFhvSystemdDeployedRevisionPath(repoRoot),
      namespace: "repo-proof",
      category: "deployment-record",
      code: "FHV_T4_INV_DEPLOY_RECORD",
    },
    {
      abs: resolveFhvT4HostProbeProofPathForPhase(runRoot, "DEPLOYMENT"),
      namespace: "host-proof",
      category: "host-probe",
      code: "FHV_T4_INV_HOST_PROBE",
    },
    {
      abs: resolveFhvT4HostProbeProofPathForPhase(runRoot, "POST_ROLLBACK"),
      namespace: "host-proof",
      category: "host-probe-post-rollback",
      code: "FHV_T4_INV_HOST_PROBE_POST_ROLLBACK",
    },
  ];

  const expectedHostProbePath = resolveFhvT4HostProbeProofPathForPhase(runRoot, "DEPLOYMENT");
  if (hostProbePath !== resolve(expectedHostProbePath)) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_HOST_PROBE_PATH_MISMATCH",
      "host-probe-json-path must be the normalized deployment host-probe proof path.",
    );
  }
  const expectedPostRollbackPath = resolveFhvT4HostProbeProofPathForPhase(runRoot, "POST_ROLLBACK");
  if (postRollbackHostProbePath !== resolve(expectedPostRollbackPath)) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_POST_ROLLBACK_HOST_PROBE_PATH_MISMATCH",
      "post-rollback-host-probe-json-path must be the normalized post-rollback host-probe proof path.",
    );
  }

  for (const entry of planned) {
    requireExisting(entry.abs, entry.code);
    assertInsideRoot(entry.abs, namespaces[entry.namespace], entry.category);
  }

  const commandResultsDir = join(runRoot, "control/command-results");
  if (existsSync(commandResultsDir)) {
    for (const name of readdirSync(commandResultsDir)) {
      const abs = join(commandResultsDir, name);
      if (statSync(abs).isFile()) {
        planned.push({
          abs,
          namespace: "run-root",
          category: "command-result",
          code: "FHV_T4_INV_COMMAND_RESULT",
        });
        assertInsideRoot(abs, runRoot, "command-result");
      }
    }
  }

  const streamingDirs = ["streaming-evidence", "streaming-evidence-resume"];
  for (const dirName of streamingDirs) {
    const dir = join(runRoot, dirName);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isFile()) {
        planned.push({
          abs,
          namespace: "run-root",
          category: "authoritative-segment",
          code: "FHV_T4_INV_SEGMENT",
        });
        assertInsideRoot(abs, runRoot, "authoritative-segment");
      }
    }
  }

  const seenRelative = new Set<string>();
  const seenAbsolute = new Set<string>();
  const inventory: FhvT4MandatoryEvidenceEntry[] = [];
  for (const entry of planned) {
    const root = namespaces[entry.namespace];
    const rootReal = realpathStrict(root);
    const absReal = realpathStrict(entry.abs);
    const relPath = relative(rootReal, absReal).split(sep).join("/");
    if (!relPath || relPath.startsWith("..") || relPath.split("/").includes("..")) {
      throw new FhvT4MandatoryEvidenceInventoryError(
        "FHV_T4_INV_RELATIVE_PATH_UNSAFE",
        `Evidence path escapes namespace ${entry.namespace}: ${entry.abs}`,
      );
    }
    const rel = `${entry.namespace}/${relPath}`;
    if (seenRelative.has(rel)) {
      throw new FhvT4MandatoryEvidenceInventoryError(
        "FHV_T4_INV_DUPLICATE_RELATIVE_PATH",
        `Duplicate relative evidence path: ${rel}`,
      );
    }
    if (seenAbsolute.has(absReal)) {
      throw new FhvT4MandatoryEvidenceInventoryError(
        "FHV_T4_INV_DUPLICATE_ABSOLUTE_PATH",
        `Duplicate absolute evidence path: ${absReal}`,
      );
    }
    seenRelative.add(rel);
    seenAbsolute.add(absReal);
    inventory.push({
      absolutePath: entry.abs,
      relativePath: rel,
      category: entry.category,
    });
  }

  if (inventory.length === 0) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_MANDATORY_INVENTORY_EMPTY",
      "Mandatory evidence inventory is empty.",
    );
  }

  return inventory.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function assertFhvT4ContinuitySnapshotsForInventory(input: {
  beforePath: string;
  afterPath: string;
}): void {
  const before = JSON.parse(readFileSync(input.beforePath, "utf8")) as FhvT4ContinuitySnapshotV1;
  const after = JSON.parse(readFileSync(input.afterPath, "utf8")) as FhvT4ContinuitySnapshotV1;
  if (before.schemaVersion !== FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_CONTINUITY_SCHEMA",
      "Continuity before schema invalid.",
    );
  }
  if (after.schemaVersion !== FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION) {
    throw new FhvT4MandatoryEvidenceInventoryError(
      "FHV_T4_INV_CONTINUITY_SCHEMA",
      "Continuity after schema invalid.",
    );
  }
}
