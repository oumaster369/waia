/**
 * DEE-436 — canonical mandatory T4A evidence inventory builder.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  FHV_T4_DEPLOYMENT_PROOF_FILENAME,
  resolveFhvT4DeploymentProofPath,
} from "@/lib/trader/observability/fhv-t4-deployment-proof";
import {
  FHV_T4_ROLLBACK_PROOF_FILENAME,
  resolveFhvT4RollbackProofPath,
} from "@/lib/trader/observability/fhv-t4-rollback-proof";
import { FHV_T4_CAMPAIGN_RUNTIME_FILENAME } from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
  type FhvT4ContinuitySnapshotV1,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { resolveFhvSystemdDeployedRevisionPath } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import { FHV_T4_PAUSE_ARMED_FILENAME } from "@/lib/trader/observability/fhv-t4-deterministic-pause";

export const FHV_T4_MANDATORY_EVIDENCE_INVENTORY_SCHEMA_VERSION =
  "fhv-t4-mandatory-evidence-inventory/v1" as const;

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
  hostProbeJsonPath?: string;
}): readonly FhvT4MandatoryEvidenceEntry[] {
  const runRoot = resolve(input.runRoot);
  const repoRoot = resolve(input.repoRoot);
  const renderedUnitsDir = resolve(input.renderedUnitsDir);
  const rel = (abs: string): string => {
    const normalized = relative(runRoot, abs).split("\\").join("/");
    if (!normalized || normalized.startsWith("..")) {
      return abs.split("/").pop() ?? abs;
    }
    return normalized;
  };

  const paths: Array<{ abs: string; category: string; code: string }> = [
    {
      abs: join(runRoot, "fhv-rehearsal-manifest.v1.json"),
      category: "manifest",
      code: "FHV_T4_INV_MANIFEST",
    },
    {
      abs: join(runRoot, "control", FHV_T4_PAUSE_ARMED_FILENAME),
      category: "pause-armed",
      code: "FHV_T4_INV_PAUSE_ARMED",
    },
    {
      abs: join(runRoot, "control/command-ledger.jsonl"),
      category: "command-ledger",
      code: "FHV_T4_INV_LEDGER",
    },
    {
      abs: join(runRoot, "fhv-rehearsal-terminal.v1.json"),
      category: "terminal",
      code: "FHV_T4_INV_TERMINAL",
    },
    {
      abs: join(runRoot, "replay-checkpoint.json"),
      category: "checkpoint",
      code: "FHV_T4_INV_CHECKPOINT",
    },
    {
      abs: join(runRoot, "fhv-resume-runtime-proof.v1.json"),
      category: "resume-proof",
      code: "FHV_T4_INV_RESUME",
    },
    { abs: join(runRoot, "run-chain.json"), category: "run-chain", code: "FHV_T4_INV_RUN_CHAIN" },
    {
      abs: join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_FILENAME),
      category: "campaign-runtime",
      code: "FHV_T4_INV_RUNTIME",
    },
    {
      abs: join(runRoot, "fhv-rehearsal-campaign-progress.v1.json"),
      category: "progress",
      code: "FHV_T4_INV_PROGRESS",
    },
    {
      abs: join(runRoot, "fhv-operator-status.v1.json"),
      category: "alert-policy",
      code: "FHV_T4_INV_STATUS",
    },
    {
      abs: join(renderedUnitsDir, "waia-fhv-campaign.service"),
      category: "rendered-unit",
      code: "FHV_T4_INV_RENDERED_CAMPAIGN",
    },
    {
      abs: join(renderedUnitsDir, "waia-fhv-observer.service"),
      category: "rendered-unit",
      code: "FHV_T4_INV_RENDERED_OBSERVER",
    },
    {
      abs: resolveFhvT4DeploymentProofPath(runRoot),
      category: "deployment-proof",
      code: "FHV_T4_INV_DEPLOY_PROOF",
    },
    {
      abs: resolve(input.continuityBeforePath),
      category: "continuity-before",
      code: "FHV_T4_INV_CONT_BEFORE",
    },
    {
      abs: resolve(input.continuityAfterPath),
      category: "continuity-after",
      code: "FHV_T4_INV_CONT_AFTER",
    },
    {
      abs: resolveFhvT4RollbackProofPath(runRoot),
      category: "rollback-proof",
      code: "FHV_T4_INV_ROLLBACK_PROOF",
    },
    {
      abs: resolveFhvSystemdDeployedRevisionPath(repoRoot),
      category: "deployment-record",
      code: "FHV_T4_INV_DEPLOY_RECORD",
    },
  ];

  if (input.hostProbeJsonPath) {
    paths.push({
      abs: resolve(input.hostProbeJsonPath),
      category: "host-probe",
      code: "FHV_T4_INV_HOST_PROBE",
    });
  }

  for (const entry of paths) {
    requireExisting(entry.abs, entry.code);
  }

  const commandResultsDir = join(runRoot, "control/command-results");
  if (existsSync(commandResultsDir)) {
    for (const name of readdirSync(commandResultsDir)) {
      const abs = join(commandResultsDir, name);
      if (statSync(abs).isFile()) {
        paths.push({ abs, category: "command-result", code: "FHV_T4_INV_COMMAND_RESULT" });
      }
    }
  }

  const seen = new Set<string>();
  const inventory: FhvT4MandatoryEvidenceEntry[] = [];
  for (const entry of paths) {
    const relativePath = rel(entry.abs);
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    inventory.push({
      absolutePath: entry.abs,
      relativePath,
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
