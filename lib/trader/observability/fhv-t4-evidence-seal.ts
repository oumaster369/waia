/**
 * DEE-436 — FHV T4A evidence seal (create + read-only verify).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  cleanupStagingDirectory,
  createUniqueStagingDirectory,
  publishDirectoryAtomic,
} from "@/lib/trader/observability/fhv-t4-directory-publish";

export const FHV_T4_EVIDENCE_SEAL_SCHEMA_VERSION = "fhv-t4-evidence-seal/v1" as const;
export const FHV_T4_EVIDENCE_SEAL_INVENTORY_FILENAME = "inventory.json" as const;
export const FHV_T4_EVIDENCE_SEAL_METADATA_FILENAME = "metadata.json" as const;
export const FHV_T4_EVIDENCE_SEAL_ROOT_FILENAME = "SEAL_ROOT.sha256" as const;
export const FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS =
  "FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS" as const;

export type FhvT4EvidenceSealInventoryEntryV1 = Readonly<{
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  uid: number;
  gid: number;
  mode: string;
}>;

export type FhvT4EvidenceSealMetadataV1 = Readonly<{
  schemaVersion: typeof FHV_T4_EVIDENCE_SEAL_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  sealedAtUtc: string;
  inventoryDigest: string;
  aggregateDigest: string;
  serviceUser: string;
  ownership: Readonly<{ uid: number; gid: number; mode: string }>;
  contentDigest: string;
}>;

export class FhvT4EvidenceSealError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4EvidenceSealError";
  }
}

function sha256FileBytes(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_PATH_UNSAFE",
      `Unsafe evidence relative path: ${relativePath}`,
    );
  }
  return normalized;
}

function formatMode(st: { mode: number | bigint }): string {
  const mode = typeof st.mode === "bigint" ? Number(st.mode) : st.mode;
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function resolveExpectedServiceUserIds(
  serviceUser: string,
  env: NodeJS.ProcessEnv = process.env,
): { uid: number; gid: number } {
  const injected = env.FHV_T4_SERVICE_USER_IDS_JSON?.trim();
  if (injected) {
    const parsed = JSON.parse(injected) as { uid: number; gid: number };
    if (!Number.isInteger(parsed.uid) || !Number.isInteger(parsed.gid)) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_SERVICE_USER_IDS_INVALID",
        "FHV_T4_SERVICE_USER_IDS_JSON must contain integer uid/gid.",
      );
    }
    return parsed;
  }
  try {
    const uid = Number.parseInt(
      execFileSync("id", ["-u", serviceUser], { encoding: "utf8" }).trim(),
      10,
    );
    const gid = Number.parseInt(
      execFileSync("id", ["-g", serviceUser], { encoding: "utf8" }).trim(),
      10,
    );
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
      throw new Error("invalid id output");
    }
    return { uid, gid };
  } catch {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_SERVICE_USER_RESOLVE_FAILED",
      `Unable to resolve uid/gid for service user ${serviceUser}.`,
    );
  }
}

function computeAggregateDigest(entries: readonly FhvT4EvidenceSealInventoryEntryV1[]): string {
  const lines = [...entries]
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((entry) => `${entry.relativePath}=${entry.sha256}`)
    .join("\n");
  return sha256Text(lines.length > 0 ? `${lines}\n` : "");
}

function computeInventoryDigest(entries: readonly FhvT4EvidenceSealInventoryEntryV1[]): string {
  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return computePayloadDigest(sorted);
}

function computeRootDigest(aggregateDigest: string, metadataDigest: string): string {
  return sha256Text(`${aggregateDigest}|${metadataDigest}`);
}

function listEvidenceFiles(evidenceRoot: string): string[] {
  if (!existsSync(evidenceRoot)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  };
  walk(evidenceRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

function assertOwnershipConsistent(
  entries: readonly FhvT4EvidenceSealInventoryEntryV1[],
  expected: { uid: number; gid: number },
): { uid: number; gid: number; mode: string } {
  if (entries.length === 0) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_INVENTORY_EMPTY",
      "Evidence inventory must not be empty.",
    );
  }
  const first = entries[0]!;
  if (
    first.uid === null ||
    first.uid === undefined ||
    first.gid === null ||
    first.gid === undefined ||
    !first.mode
  ) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_OWNERSHIP_NULL",
      "Evidence ownership uid/gid/mode must not be null.",
    );
  }
  if (first.uid !== expected.uid || first.gid !== expected.gid) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_OWNERSHIP_SERVICE_USER_MISMATCH",
      "Evidence ownership must match configured service user.",
    );
  }
  for (const entry of entries) {
    if (entry.uid !== first.uid || entry.gid !== first.gid) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_OWNERSHIP_INCONSISTENT",
        `Inconsistent ownership for ${entry.relativePath}.`,
      );
    }
  }
  return { uid: first.uid, gid: first.gid, mode: first.mode };
}

export function sealFhvT4EvidenceRoot(input: {
  sealDestination: string;
  evidenceFiles: readonly Readonly<{ absolutePath: string; relativePath: string }>[];
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  serviceUser: string;
  sealedAtUtc?: string;
}): {
  classification: typeof FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS;
  sealDestination: string;
  rootDigest: string;
  metadata: FhvT4EvidenceSealMetadataV1;
} {
  const serviceUser = input.serviceUser.trim();
  if (!serviceUser) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_SERVICE_USER_REQUIRED",
      "serviceUser is required for evidence sealing.",
    );
  }
  const expectedIds = resolveExpectedServiceUserIds(serviceUser);
  const sealDestination = resolve(input.sealDestination);
  if (existsSync(sealDestination)) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_DESTINATION_EXISTS",
      "Seal destination must not exist before publish.",
    );
  }

  const stagingRoot = createUniqueStagingDirectory(dirname(sealDestination), "fhv-t4-seal");
  const evidenceRoot = join(stagingRoot, "evidence");
  mkdirSync(evidenceRoot, { recursive: true });

  const inventory: FhvT4EvidenceSealInventoryEntryV1[] = [];
  const seenPaths = new Set<string>();
  try {
    for (const file of input.evidenceFiles) {
      const relativePath = assertSafeRelativePath(file.relativePath);
      if (seenPaths.has(relativePath)) {
        throw new FhvT4EvidenceSealError(
          "FHV_T4_SEAL_DUPLICATE_INVENTORY_PATH",
          `Duplicate inventory path: ${relativePath}`,
        );
      }
      seenPaths.add(relativePath);
      if (!existsSync(file.absolutePath)) {
        throw new FhvT4EvidenceSealError(
          "FHV_T4_SEAL_EVIDENCE_MISSING",
          `Mandatory evidence missing: ${file.absolutePath}`,
        );
      }
      const dest = join(evidenceRoot, ...relativePath.split("/"));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file.absolutePath, dest);
      const st = statSync(dest);
      const sha256 = sha256FileBytes(dest);
      inventory.push({
        relativePath,
        sha256,
        sizeBytes: st.size,
        uid: st.uid,
        gid: st.gid,
        mode: formatMode(st),
      });
    }

    inventory.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const ownership = assertOwnershipConsistent(inventory, expectedIds);
    const inventoryDigest = computeInventoryDigest(inventory);
    const aggregateDigest = computeAggregateDigest(inventory);
    const metadataWithoutDigest = {
      schemaVersion: FHV_T4_EVIDENCE_SEAL_SCHEMA_VERSION,
      releaseSha: input.releaseSha.trim(),
      releaseTag: input.releaseTag.trim(),
      runId: input.runId.trim(),
      organizationId: input.organizationId.trim(),
      sealedAtUtc: input.sealedAtUtc ?? new Date().toISOString(),
      inventoryDigest,
      aggregateDigest,
      serviceUser,
      ownership,
    };
    const metadata: FhvT4EvidenceSealMetadataV1 = {
      ...metadataWithoutDigest,
      contentDigest: computePayloadDigest(metadataWithoutDigest),
    };

    writeFileSync(
      join(stagingRoot, FHV_T4_EVIDENCE_SEAL_INVENTORY_FILENAME),
      `${JSON.stringify(inventory, null, 2)}\n`,
    );
    writeFileSync(
      join(stagingRoot, FHV_T4_EVIDENCE_SEAL_METADATA_FILENAME),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    const rootDigest = computeRootDigest(aggregateDigest, metadata.contentDigest);
    writeFileSync(join(stagingRoot, FHV_T4_EVIDENCE_SEAL_ROOT_FILENAME), `${rootDigest}\n`);

    publishDirectoryAtomic(stagingRoot, sealDestination);

    return {
      classification: FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS,
      sealDestination,
      rootDigest,
      metadata,
    };
  } catch (error) {
    cleanupStagingDirectory(stagingRoot);
    throw error;
  }
}

export function verifyFhvT4EvidenceSeal(input: {
  sealDestination: string;
  releaseSha: string;
  runId: string;
  organizationId: string;
  releaseTag?: string;
  serviceUser?: string;
}): {
  classification: typeof FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS;
  rootDigest: string;
  metadata: FhvT4EvidenceSealMetadataV1;
} {
  const sealDestination = resolve(input.sealDestination);
  const inventoryPath = join(sealDestination, FHV_T4_EVIDENCE_SEAL_INVENTORY_FILENAME);
  const metadataPath = join(sealDestination, FHV_T4_EVIDENCE_SEAL_METADATA_FILENAME);
  const rootPath = join(sealDestination, FHV_T4_EVIDENCE_SEAL_ROOT_FILENAME);
  for (const path of [inventoryPath, metadataPath, rootPath]) {
    if (!existsSync(path)) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_MISSING_ARTIFACT",
        `Missing seal file: ${path}`,
      );
    }
  }

  const inventory = JSON.parse(
    readFileSync(inventoryPath, "utf8"),
  ) as FhvT4EvidenceSealInventoryEntryV1[];
  if (!Array.isArray(inventory)) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_INVENTORY_INVALID",
      "inventory.json must be an array.",
    );
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as FhvT4EvidenceSealMetadataV1;
  if (metadata.schemaVersion !== FHV_T4_EVIDENCE_SEAL_SCHEMA_VERSION) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_SCHEMA_MISMATCH",
      "Seal metadata schema mismatch.",
    );
  }
  if (metadata.releaseSha !== input.releaseSha.trim()) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_RELEASE_SHA_MISMATCH",
      "Seal releaseSha mismatch.",
    );
  }
  if (metadata.runId !== input.runId.trim()) {
    throw new FhvT4EvidenceSealError("FHV_T4_SEAL_RUN_ID_MISMATCH", "Seal runId mismatch.");
  }
  if (metadata.organizationId !== input.organizationId.trim()) {
    throw new FhvT4EvidenceSealError("FHV_T4_SEAL_ORG_MISMATCH", "Seal organizationId mismatch.");
  }
  if (input.releaseTag !== undefined && metadata.releaseTag !== input.releaseTag.trim()) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_RELEASE_TAG_MISMATCH",
      "Seal releaseTag mismatch.",
    );
  }
  if (
    metadata.ownership === undefined ||
    metadata.ownership.uid === null ||
    metadata.ownership.gid === null ||
    !metadata.ownership.mode
  ) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_OWNERSHIP_MISSING",
      "Seal ownership/mode metadata missing or null.",
    );
  }
  if (input.serviceUser !== undefined && metadata.serviceUser !== input.serviceUser.trim()) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_SERVICE_USER_MISMATCH",
      "Seal serviceUser mismatch.",
    );
  }

  const { contentDigest, ...withoutDigest } = metadata;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_METADATA_DIGEST_MISMATCH",
      "Seal metadata contentDigest mismatch.",
    );
  }
  if (computeInventoryDigest(inventory) !== metadata.inventoryDigest) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_INVENTORY_DIGEST_MISMATCH",
      "Seal inventoryDigest mismatch.",
    );
  }
  if (computeAggregateDigest(inventory) !== metadata.aggregateDigest) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_AGGREGATE_DIGEST_MISMATCH",
      "Seal aggregateDigest mismatch.",
    );
  }

  const evidenceRoot = join(sealDestination, "evidence");
  if (!existsSync(evidenceRoot)) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_EVIDENCE_ROOT_MISSING",
      "Seal evidence root missing.",
    );
  }
  const onDisk = listEvidenceFiles(evidenceRoot);
  const inventoryPaths = new Set(inventory.map((entry) => entry.relativePath));
  for (const entry of inventory) {
    if (
      entry.uid === null ||
      entry.uid === undefined ||
      entry.gid === null ||
      entry.gid === undefined ||
      !entry.mode
    ) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_INVENTORY_OWNERSHIP_NULL",
        `Inventory entry ownership null: ${entry.relativePath}`,
      );
    }
    const absolute = join(evidenceRoot, ...entry.relativePath.split("/"));
    if (!existsSync(absolute)) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_INVENTORY_ENTRY_MISSING",
        `Inventory entry missing on disk: ${entry.relativePath}`,
      );
    }
    const digest = sha256FileBytes(absolute);
    if (digest !== entry.sha256) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_EVIDENCE_TAMPERED",
        `Evidence digest mismatch: ${entry.relativePath}`,
      );
    }
    const st = statSync(absolute);
    if (st.uid !== entry.uid || st.gid !== entry.gid || formatMode(st) !== entry.mode) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_EVIDENCE_OWNERSHIP_MISMATCH",
        `Evidence ownership mismatch: ${entry.relativePath}`,
      );
    }
  }
  for (const absolute of onDisk) {
    const relativePath = relative(evidenceRoot, absolute).split(sep).join("/");
    if (!inventoryPaths.has(relativePath)) {
      throw new FhvT4EvidenceSealError(
        "FHV_T4_SEAL_UNBOUND_EVIDENCE",
        `Unbound evidence file under seal: ${relativePath}`,
      );
    }
  }

  const expectedRoot = computeRootDigest(metadata.aggregateDigest, metadata.contentDigest);
  const observedRoot = readFileSync(rootPath, "utf8").trim();
  if (observedRoot !== expectedRoot) {
    throw new FhvT4EvidenceSealError(
      "FHV_T4_SEAL_ROOT_DIGEST_MISMATCH",
      "SEAL_ROOT.sha256 mismatch.",
    );
  }

  return {
    classification: FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS,
    rootDigest: observedRoot,
    metadata,
  };
}
