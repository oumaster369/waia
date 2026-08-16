import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { assertRealProviderAcquisitionEvidenceClass } from "@/lib/trader/market-data/fhv-acquisition-evidence-class";
import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import {
  readFhvAcquisitionReceiptV2,
  type FhvAcquisitionReceiptV2,
} from "@/lib/trader/market-data/fhv-real-htx-acquisition";
import type { FhvRevisionRiskSampleEvidenceV1 } from "@/lib/trader/market-data/fhv-revision-risk-evidence";
import {
  FHV_OFFICIAL_SYMBOLS,
  fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA =
  "fhv-pre-holdout-qualification-receipt/v1" as const;
export const FHV_PRE_HOLDOUT_QUALIFICATION_MODE = "OFFICIAL_PRE_HOLDOUT_REAL_DATA" as const;
export const FHV_PRE_HOLDOUT_HOLDOUT_STATUS = "SEALED_NOT_ACCESSED" as const;
export const FHV_PRE_HOLDOUT_PARTITIONS = ["development", "walk-forward"] as const;

export type FhvPreHoldoutQualificationMode = typeof FHV_PRE_HOLDOUT_QUALIFICATION_MODE;

export class FhvPreHoldoutQualificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvPreHoldoutQualificationError";
  }
}

export type FhvPreHoldoutPartitionEvidenceV1 = Readonly<{
  partition: (typeof FHV_PRE_HOLDOUT_PARTITIONS)[number];
  symbol: FhvOfficialSymbolCode;
  acquisitionReceiptDigest: string;
  rawSha256: string;
  semanticContentDigest: string;
  barCount: number;
  firstBarOpen: string;
  lastBarClose: string;
  gapDuplicateIntegrity: "PASS";
  normalizationIdentity: string;
  pageCount: number;
  retryCount: number;
}>;

export type FhvPreHoldoutQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA;
  qualificationMode: FhvPreHoldoutQualificationMode;
  classification: "PRE_HOLDOUT_QUALIFICATION=PASS";
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityEvidenceDigest: string;
  canonicalBoundaries: Readonly<{
    development: { startUtc: string; endUtc: string };
    walkForward: { startUtc: string; endUtc: string };
  }>;
  interval: "1m";
  symbols: readonly FhvOfficialSymbolCode[];
  acquisitionReceiptDigests: readonly string[];
  partitions: readonly FhvPreHoldoutPartitionEvidenceV1[];
  developmentWalkForwardContentDigest: string;
  holdout: Readonly<{
    canonicalBoundary: { startUtc: string; endUtc: string };
    status: typeof FHV_PRE_HOLDOUT_HOLDOUT_STATUS;
    sourceCapabilityEvidenceDigest: string;
  }>;
  revisionRiskEvidence: readonly FhvRevisionRiskSampleEvidenceV1[];
  qualifiedAtUtc: string;
  qualificationReceiptDigest: string;
}>;

function fail(code: string, message: string): never {
  throw new FhvPreHoldoutQualificationError(code, message);
}

function scanV2File(filePath: string): {
  rawSha256: string;
  barCount: number;
  firstBarOpen: string;
  lastBarClose: string;
  semanticContentDigest: string;
} {
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  const digests: string[] = [];
  let remainder = "";
  const buffer = Buffer.alloc(65536);
  let barCount = 0;
  let firstBarOpen = "";
  let lastBarClose = "";
  let lineNumber = 0;
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        remainder += buffer.subarray(0, bytesRead).toString("utf8");
      }
      const parts = remainder.split("\n");
      remainder = bytesRead > 0 ? (parts.pop() ?? "") : "";
      const lines = bytesRead > 0 ? parts : [...parts, remainder].filter((line) => line.length > 0);
      if (bytesRead <= 0 && remainder.length > 0) {
        lines.push(remainder);
        remainder = "";
      }
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        lineNumber += 1;
        const record = parseFhvBarsV2Line(line, lineNumber);
        const bar = fhvBarsV2RecordToBar(record);
        if (barCount === 0) {
          firstBarOpen = bar.barOpenTime;
        }
        lastBarClose = bar.barCloseTime;
        digests.push(computeBarContentDigest(bar));
        barCount += 1;
      }
      if (bytesRead <= 0) {
        break;
      }
    }
  } finally {
    closeSync(fd);
  }
  void statSync(filePath);
  return {
    rawSha256: hash.digest("hex"),
    barCount,
    firstBarOpen,
    lastBarClose,
    semanticContentDigest: computeStableJsonDigest(digests),
  };
}

function assertReceiptBinding(input: {
  receipt: FhvAcquisitionReceiptV2;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityEvidenceDigest: string;
  partition: (typeof FHV_PRE_HOLDOUT_PARTITIONS)[number];
  symbol: FhvOfficialSymbolCode;
}): void {
  assertRealProviderAcquisitionEvidenceClass(input.receipt.evidenceClass);
  if (input.receipt.releaseSha !== input.releaseSha) {
    fail("RELEASE_MISMATCH", "acquisition receipt releaseSha mismatch");
  }
  if (
    input.receipt.organizationId !== input.organizationId ||
    input.receipt.operatorId !== input.operatorId
  ) {
    fail("ORGANIZATION_OPERATOR_MISMATCH", "org/operator mismatch");
  }
  if (input.receipt.sourceCapabilityReceiptDigest !== input.sourceCapabilityEvidenceDigest) {
    fail("SOURCE_CAPABILITY_DIGEST_MISMATCH", "source-capability digest mismatch");
  }
  const canonical = resolveFhvCanonicalPartitionInterval(input.partition);
  if (input.receipt.startUtc !== canonical.startUtc || input.receipt.endUtc !== canonical.endUtc) {
    fail(
      "PARTITION_BOUNDARY_MISMATCH",
      `${input.partition}/${input.symbol} receipt bounds must equal canonical partition`,
    );
  }
  if (input.receipt.partition !== input.partition || input.receipt.symbol !== input.symbol) {
    fail("PARTITION_SYMBOL_MISMATCH", "receipt partition/symbol mismatch");
  }
}

export function qualifyFhvPreHoldoutRealData(input: {
  datasetRoot: string;
  acquisitionReceiptPaths: readonly string[];
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityEvidenceDigest: string;
  revisionRiskEvidence: readonly FhvRevisionRiskSampleEvidenceV1[];
  qualifiedAtUtc?: string;
}): FhvPreHoldoutQualificationReceiptV1 {
  assertPathDoesNotAccessBlindHoldoutPayload(input.datasetRoot);
  if (input.acquisitionReceiptPaths.length !== 4) {
    fail("ACQUISITION_RECEIPT_COUNT", "exactly four DEVELOPMENT/WALK_FORWARD receipts required");
  }
  const releaseSha = input.releaseSha.trim().toLowerCase();
  const expected = FHV_PRE_HOLDOUT_PARTITIONS.flatMap((partition) =>
    FHV_OFFICIAL_SYMBOLS.map((symbol) => `${partition}:${symbol}`),
  );
  const seen = new Set<string>();
  const partitions: FhvPreHoldoutPartitionEvidenceV1[] = [];
  const receiptDigests: string[] = [];

  for (const receiptPath of input.acquisitionReceiptPaths) {
    assertPathDoesNotAccessBlindHoldoutPayload(receiptPath);
    const receipt = readFhvAcquisitionReceiptV2(receiptPath);
    if (receipt.partition === "blind-holdout") {
      fail(
        "HOLDOUT_RECEIPT_FORBIDDEN",
        "pre-holdout qualification cannot consume holdout receipts",
      );
    }
    const partition = receipt.partition;
    const key = `${partition}:${receipt.symbol}`;
    if (!expected.includes(key) || seen.has(key)) {
      fail("PARTITION_SET_INVALID", `unexpected or duplicate receipt ${key}`);
    }
    seen.add(key);
    assertReceiptBinding({
      receipt,
      releaseSha,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      sourceCapabilityEvidenceDigest: input.sourceCapabilityEvidenceDigest,
      partition,
      symbol: receipt.symbol,
    });
    const relativePath = fhvOfficialPartitionFileRelativePath({
      partition,
      symbol: receipt.symbol,
    });
    const filePath = join(input.datasetRoot, relativePath);
    if (!existsSync(filePath)) {
      fail("PARTITION_FILE_MISSING", `missing ${relativePath}`);
    }
    const scanned = scanV2File(filePath);
    if (scanned.rawSha256 !== receipt.rawSha256) {
      fail("ACQUISITION_OUTPUT_MUTATION", `raw digest mismatch for ${key}`);
    }
    if (scanned.semanticContentDigest !== receipt.semanticContentDigest) {
      fail("ACQUISITION_OUTPUT_MUTATION", `semantic digest mismatch for ${key}`);
    }
    receiptDigests.push(receipt.acquisitionReceiptDigest);
    partitions.push({
      partition,
      symbol: receipt.symbol,
      acquisitionReceiptDigest: receipt.acquisitionReceiptDigest,
      rawSha256: receipt.rawSha256,
      semanticContentDigest: receipt.semanticContentDigest,
      barCount: scanned.barCount,
      firstBarOpen: scanned.firstBarOpen,
      lastBarClose: scanned.lastBarClose,
      gapDuplicateIntegrity: "PASS",
      normalizationIdentity: receipt.normalizationIdentity,
      pageCount: receipt.pageCount,
      retryCount: receipt.retryCount,
    });
  }

  if (seen.size !== 4) {
    fail("ACQUISITION_RECEIPT_COUNT", "missing one of four DEVELOPMENT/WALK_FORWARD receipts");
  }

  partitions.sort((left, right) =>
    `${left.partition}:${left.symbol}`.localeCompare(`${right.partition}:${right.symbol}`),
  );

  const developmentWalkForwardContentDigest = computeStableJsonDigest(
    partitions.map((entry) => ({
      partition: entry.partition,
      symbol: entry.symbol,
      semanticContentDigest: entry.semanticContentDigest,
    })),
  );

  const body = {
    schemaVersion: FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA,
    qualificationMode: FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
    classification: "PRE_HOLDOUT_QUALIFICATION=PASS" as const,
    releaseSha,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    sourceCapabilityEvidenceDigest: input.sourceCapabilityEvidenceDigest,
    canonicalBoundaries: {
      development: FHV_DATASET_PARTITIONS_V1.development,
      walkForward: FHV_DATASET_PARTITIONS_V1.walkForward,
    },
    interval: "1m" as const,
    symbols: FHV_OFFICIAL_SYMBOLS,
    acquisitionReceiptDigests: receiptDigests,
    partitions,
    developmentWalkForwardContentDigest,
    holdout: {
      canonicalBoundary: {
        startUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.startUtc,
        endUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc,
      },
      status: FHV_PRE_HOLDOUT_HOLDOUT_STATUS,
      sourceCapabilityEvidenceDigest: input.sourceCapabilityEvidenceDigest,
    },
    revisionRiskEvidence: input.revisionRiskEvidence,
    qualifiedAtUtc: input.qualifiedAtUtc ?? new Date().toISOString(),
  };
  return {
    ...body,
    qualificationReceiptDigest: computeStableJsonDigest(body),
  };
}

export function writeFhvPreHoldoutQualificationReceipt(input: {
  receiptDir: string;
  receipt: FhvPreHoldoutQualificationReceiptV1;
}): string {
  const path = join(input.receiptDir, "fhv-pre-holdout-qualification-receipt.v1.json");
  writeFileAtomicExclusive(path, `${JSON.stringify(input.receipt, null, 2)}\n`);
  return path;
}

export function readFhvPreHoldoutQualificationReceipt(
  path: string,
): FhvPreHoldoutQualificationReceiptV1 {
  assertPathDoesNotAccessBlindHoldoutPayload(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvPreHoldoutQualificationReceiptV1;
  if (parsed.schemaVersion !== FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA) {
    fail("SCHEMA_UNSUPPORTED", `unsupported ${String(parsed.schemaVersion)}`);
  }
  if (parsed.qualificationMode !== FHV_PRE_HOLDOUT_QUALIFICATION_MODE) {
    fail("MODE_MISMATCH", "receipt is not OFFICIAL_PRE_HOLDOUT_REAL_DATA");
  }
  if (parsed.holdout.status !== FHV_PRE_HOLDOUT_HOLDOUT_STATUS) {
    fail("HOLDOUT_STATUS_INVALID", "holdout must remain SEALED_NOT_ACCESSED");
  }
  if ("blindPayloadDigest" in parsed || "holdoutRawSha256" in parsed) {
    fail(
      "HOLDOUT_PAYLOAD_DIGEST_FORBIDDEN",
      "pre-holdout receipt must not carry blind payload digests",
    );
  }
  const { qualificationReceiptDigest, ...body } = parsed;
  if (computeStableJsonDigest(body) !== qualificationReceiptDigest) {
    fail("RECEIPT_DIGEST_MISMATCH", "pre-holdout qualification digest mismatch");
  }
  return parsed;
}

export function assertFhvPreHoldoutFilesMatchReceipt(input: {
  datasetRoot: string;
  receipt: FhvPreHoldoutQualificationReceiptV1;
}): void {
  assertPathDoesNotAccessBlindHoldoutPayload(input.datasetRoot);
  for (const entry of input.receipt.partitions) {
    const relativePath = fhvOfficialPartitionFileRelativePath({
      partition: entry.partition,
      symbol: entry.symbol,
    });
    const filePath = join(input.datasetRoot, relativePath);
    assertPathDoesNotAccessBlindHoldoutPayload(filePath);
    if (!existsSync(filePath)) {
      fail("PARTITION_FILE_MISSING", `missing ${relativePath}`);
    }
    const scanned = scanV2File(filePath);
    if (
      scanned.rawSha256 !== entry.rawSha256 ||
      scanned.semanticContentDigest !== entry.semanticContentDigest
    ) {
      fail(
        "ACQUISITION_OUTPUT_MUTATION",
        `partition file mutation for ${entry.partition}:${entry.symbol}`,
      );
    }
  }
}

export function loadFhvPreHoldoutPartitionBars(input: {
  datasetRoot: string;
  partition: (typeof FHV_PRE_HOLDOUT_PARTITIONS)[number];
  symbol: FhvOfficialSymbolCode;
}): Bar[] {
  const relativePath = fhvOfficialPartitionFileRelativePath({
    partition: input.partition,
    symbol: input.symbol,
  });
  const filePath = join(input.datasetRoot, relativePath);
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  if (!existsSync(filePath)) {
    fail("PARTITION_FILE_MISSING", `missing ${relativePath}`);
  }
  const raw = readFileSync(filePath, "utf8");
  const bars: Bar[] = [];
  let lineNumber = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    lineNumber += 1;
    bars.push(fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber)));
  }
  return bars;
}

export function assertPreHoldoutNotFullHistorical(qualificationMode: string): void {
  if (qualificationMode === FHV_PRE_HOLDOUT_QUALIFICATION_MODE) {
    fail(
      "PRE_HOLDOUT_CANNOT_AUTHORIZE_FULL_HISTORICAL",
      "OFFICIAL_PRE_HOLDOUT_REAL_DATA cannot authorize FULL_HISTORICAL",
    );
  }
}
