import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { serialize } from "node:v8";
import { computeSemanticSha256Hex } from "../../lib/trader/intelligence/htr-semantic-canonical-json";
import { terminalRhFromOutcome13dV1 } from "../../lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import {
  issueForecastV1,
  type PredictivePackageV1,
  type SourceAnchor,
} from "../../lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  reuseScientificEvidenceV1,
  withScientificCheckpointsV1,
} from "../../lib/trader/historical-simulation-v2/scientific-checkpoint-context-v1";
import { createScientificCheckpointStoreV1 } from "./scientific-checkpoint-store-v1";
import { deriveScientificCheckpointKeyV1 } from "./scientific-checkpoint-key-v1";
import { buildPreservedWfExpectedInventoryV1 } from "./preserved-wf-inventory-v1";
import {
  parseG1TrustedOriginMappingEnvelopeV1,
  WF_FORECAST_BATCH_SIZE_V1,
  WF_FORECAST_BATCH_STAGE_V1,
  type G1TrustedOriginMappingEnvelopeV1,
  type G1TrustedOriginSurfaceV1,
} from "./g1-trusted-origin-mapping-schema-v1";

export const MISSING_ONLY_FORECAST_PRODUCER_CONTRACT_V1 =
  "waia.trader.missing_only_forecast_producer.v1" as const;
export const ISSUE_FORECAST_V1_ENTRY =
  "lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1.ts" as const;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const fail = (reason: string): never => {
  throw new Error(`MISSING_ONLY_FORECAST_PRODUCER_REFUSED:${reason}`);
};
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function privateDirectory(path: string) {
  const st = lstatSync(path);
  if (
    st.isSymbolicLink() ||
    !st.isDirectory() ||
    (st.mode & 0o077) !== 0 ||
    (process.getuid && st.uid !== process.getuid()) ||
    realpathSync(path) !== resolve(path)
  )
    fail("PRIVATE_PATH");
}
function writeExclusive(path: string, bytes: string) {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function ensurePrivateRoot(path: string) {
  if (!isAbsolute(path) || resolve(path) === "/") fail("ROOT");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  privateDirectory(path);
  return realpathSync(path);
}

const BUILDER_KEYS = Object.freeze([
  "buildPackage",
  "packageBuilder",
  "builder",
  "fallback",
] as const);
function refuseBuilderFallback(input: object): void {
  for (const key of BUILDER_KEYS) if (Object.hasOwn(input, key)) fail("BUILDER_FALLBACK");
}

export type MissingOnlyProducerIdentityV1 = {
  authorityGranted: false;
  contractVersion: typeof MISSING_ONLY_FORECAST_PRODUCER_CONTRACT_V1;
  producerGitSha: string;
  issueForecastTransitiveSourceClosureDigestHex: string;
  issueForecastTransitiveSourceFileCount: number;
  runtime: { node: string; os: string; arch: string };
  mappingSchemaVersion: "waia.trader.g1_trusted_origin_mapping.v1";
};
export type ForecastBatchRowV1 = {
  anchorId: string;
  observedReturn: number;
  challengerProbabilities: readonly number[];
};
export type MissingWfForecastBatchV1 = {
  surfaceKey: G1TrustedOriginSurfaceV1["surfaceKey"];
  offset: number;
  anchorCount: number;
  originKey: string;
};

function currentRuntime() {
  return Object.freeze({ node: process.version, os: process.platform, arch: process.arch });
}

/** SHA-256 of sorted [relative path, file digest] lines over issueForecastV1's local import closure. */
export function computeIssueForecastV1TransitiveSourceClosureV1(sourceRoot: string) {
  if (!isAbsolute(sourceRoot) || resolve(sourceRoot) === "/") fail("SOURCE_ROOT");
  const root = realpathSync(sourceRoot);
  const files = new Set<string>();
  const visit = (rel: string) => {
    const path = join(root, rel);
    if (files.has(rel)) return;
    if (lstatSync(path).isSymbolicLink()) fail("SOURCE_SYMLINK");
    files.add(rel);
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)) {
      const spec = match[1]!;
      if (
        spec.startsWith("node:") ||
        spec === "server-only" ||
        (!spec.startsWith(".") && !spec.startsWith("@/"))
      )
        continue;
      const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(path, "..", spec);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts")];
      const found = candidates.find(
        (candidate) => existsSync(candidate) && lstatSync(candidate).isFile(),
      );
      if (!found) fail("SOURCE_CLOSURE");
      const next = relative(root, found);
      if (next.startsWith("..")) fail("SOURCE_ESCAPE");
      visit(next);
    }
  };
  visit(ISSUE_FORECAST_V1_ENTRY);
  const ordered = [...files].sort();
  const hash = createHash("sha256");
  for (const rel of ordered)
    hash.update(`${JSON.stringify([rel, digest(readFileSync(join(root, rel)))])}\n`);
  return Object.freeze({
    digestHex: hash.digest("hex"),
    fileCount: ordered.length,
    files: Object.freeze(ordered),
  });
}

export function bindMissingOnlyProducerIdentityV1(input: {
  producerGitSha: string;
  sourceRoot: string;
}): MissingOnlyProducerIdentityV1 {
  if (!HEX40.test(input.producerGitSha)) fail("PRODUCER_SHA");
  const closure = computeIssueForecastV1TransitiveSourceClosureV1(input.sourceRoot);
  return Object.freeze({
    authorityGranted: false,
    contractVersion: MISSING_ONLY_FORECAST_PRODUCER_CONTRACT_V1,
    producerGitSha: input.producerGitSha,
    issueForecastTransitiveSourceClosureDigestHex: closure.digestHex,
    issueForecastTransitiveSourceFileCount: closure.fileCount,
    runtime: currentRuntime(),
    mappingSchemaVersion: "waia.trader.g1_trusted_origin_mapping.v1",
  });
}

export function createOriginReadOnlyPortV1(originRoot: string) {
  if (!isAbsolute(originRoot) || resolve(originRoot) === "/") fail("ORIGIN_ROOT");
  const root = realpathSync(originRoot);
  privateDirectory(root);
  const refuseWrite = (): never => fail("ORIGIN_WRITE");
  return Object.freeze({
    root,
    hasSealedKey(key: string): boolean {
      if (!HEX64.test(key)) fail("KEY");
      try {
        const st = lstatSync(join(root, key));
        return !st.isSymbolicLink() && st.isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    package: refuseWrite,
    evidence: refuseWrite,
    evidenceAsync: refuseWrite,
  });
}

function claimPath(root: string, surfaceKey: string, offset: number) {
  return join(root, "claims", surfaceKey.replace(":", "_"), `${offset}.claim`);
}
function completionPath(root: string, surfaceKey: string, offset: number) {
  return join(root, "completions", surfaceKey.replace(":", "_"), `${offset}.complete`);
}

export type ProducerJournalV1 = {
  root: string;
  claim(surfaceKey: string, offset: number, retryIncomplete?: boolean): void;
  complete(record: {
    surfaceKey: string;
    offset: number;
    originKey: string;
    producerKey: string;
    payloadDigest: string;
    rowsSha256: string;
  }): void;
  hasCompletion(surfaceKey: string, offset: number): boolean;
  completedOffsets(surfaceKey: string): number[];
};

export function createProducerJournalV1(
  producerRoot: string,
  identity: MissingOnlyProducerIdentityV1,
): ProducerJournalV1 {
  const root = ensurePrivateRoot(producerRoot);
  const prepare = (path: string) => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    privateDirectory(path);
  };
  return Object.freeze({
    root,
    claim(surfaceKey, offset, retryIncomplete = false) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % WF_FORECAST_BATCH_SIZE_V1 !== 0)
        fail("OFFSET");
      if (existsSync(completionPath(root, surfaceKey, offset))) fail("DUPLICATE_COMPLETED");
      const dir = join(root, "claims", surfaceKey.replace(":", "_"));
      prepare(dir);
      const path = claimPath(root, surfaceKey, offset);
      if (existsSync(path)) {
        if (!retryIncomplete) fail("DUPLICATE_CLAIM");
        return;
      }
      writeExclusive(
        path,
        JSON.stringify({
          surfaceKey,
          offset,
          producerGitSha: identity.producerGitSha,
          contractVersion: identity.contractVersion,
          claimed: true,
        }),
      );
    },
    complete(record) {
      if (
        !HEX64.test(record.payloadDigest) ||
        !HEX64.test(record.rowsSha256) ||
        !HEX64.test(record.originKey) ||
        !HEX64.test(record.producerKey)
      )
        fail("COMPLETE_RECORD");
      if (existsSync(completionPath(root, record.surfaceKey, record.offset)))
        fail("DUPLICATE_COMPLETED");
      if (!existsSync(claimPath(root, record.surfaceKey, record.offset))) fail("UNCLAIMED");
      const dir = join(root, "completions", record.surfaceKey.replace(":", "_"));
      prepare(dir);
      writeExclusive(
        completionPath(root, record.surfaceKey, record.offset),
        JSON.stringify({
          schemaVersion: "waia.trader.missing_only_forecast_batch_completion.v1",
          authorityGranted: false,
          producerGitSha: identity.producerGitSha,
          contractVersion: identity.contractVersion,
          ...record,
        }),
      );
    },
    hasCompletion(surfaceKey, offset) {
      return existsSync(completionPath(root, surfaceKey, offset));
    },
    completedOffsets(surfaceKey) {
      const dir = join(root, "completions", surfaceKey.replace(":", "_"));
      if (!existsSync(dir)) return [];
      const offsets: number[] = [];
      for (const name of readdirSync(dir)) {
        const match = /^(\d+)\.complete$/.exec(name);
        if (match) offsets.push(Number(match[1]));
      }
      return offsets.sort((a, b) => a - b);
    },
  });
}

export function expectedOffsetsV1(
  domain: G1TrustedOriginSurfaceV1["expectedWfForecastBatchDomain"],
): number[] {
  const offsets: number[] = [];
  for (
    let offset = domain.offsets.start;
    offset < domain.offsets.endExclusive;
    offset += domain.offsets.step
  )
    offsets.push(offset);
  return offsets;
}

export function refuseCoverageGapV1(
  expected: readonly number[],
  origin: readonly number[],
  completed: readonly number[],
) {
  const present = new Set([...origin, ...completed]);
  const completedSet = new Set(completed);
  for (const offset of completed) if (!expected.includes(offset)) fail("UNEXPECTED_OFFSET");
  const missing = expected.filter((offset) => !present.has(offset));
  if (missing.length) fail("GAP");
  if (completedSet.size !== completed.length) fail("DUPLICATE_COMPLETED");
}

function freezeAnchor(source: SourceAnchor): SourceAnchor {
  return Object.freeze({
    venue: source.venue,
    market: source.market,
    symbol: source.symbol,
    closedBarEpochMs: source.closedBarEpochMs,
    barContentDigest: source.barContentDigest,
    realizedVol20m_1m: source.realizedVol20m_1m,
    outcome13d: Object.freeze([...source.outcome13d]),
  });
}

export function enumerateMissingWfForecastBatchesV1(input: {
  envelope: G1TrustedOriginMappingEnvelopeV1;
  surfaceKey: G1TrustedOriginSurfaceV1["surfaceKey"];
  sourceCorpus: readonly SourceAnchor[];
  origin: { hasSealedKey(key: string): boolean };
  journal?: Pick<ProducerJournalV1, "hasCompletion">;
}): readonly MissingWfForecastBatchV1[] {
  refuseBuilderFallback(input);
  const surface = input.envelope.mapping.surfaces.find(
    (entry) => entry.surfaceKey === input.surfaceKey,
  );
  if (!surface) fail("SURFACE");
  const origin = input.envelope.mapping.O;
  const inventory = buildPreservedWfExpectedInventoryV1({
    origin: {
      organizationId: origin.organizationId,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      releaseSha: origin.releaseSha,
      runtime: origin.runtime,
      packageGenerationDigestHex: surface.selectedPackage.generationDigestHex,
      packageContentDigestHex: surface.selectedPackage.contentDigestHex,
    },
    evaluationPartitionReceiptDigestHex: surface.evaluationPartition.receiptDigestHex,
    sourceCorpus: input.sourceCorpus,
  });
  const domain = surface.expectedWfForecastBatchDomain;
  if (
    inventory.anchorCount !== domain.expectedAnchors ||
    inventory.batches.length !== domain.expectedBatches ||
    inventory.batches.at(-1)?.anchorCount !== domain.lastBatchAnchorCount
  )
    fail("DOMAIN");
  const keyOrderDigest = digest(inventory.batches.map((batch) => batch.key).join("\n"));
  if (keyOrderDigest !== domain.expectedKeyOrderDigest) fail("KEY_ORDER");
  const missing: MissingWfForecastBatchV1[] = [];
  for (const batch of inventory.batches) {
    if (
      input.origin.hasSealedKey(batch.key) ||
      input.journal?.hasCompletion(surface.surfaceKey, batch.offset)
    )
      continue;
    missing.push(
      Object.freeze({
        surfaceKey: surface.surfaceKey,
        offset: batch.offset,
        anchorCount: batch.anchorCount,
        originKey: batch.key,
      }),
    );
  }
  return Object.freeze(missing);
}

function bindSelectedPackage(
  surface: G1TrustedOriginSurfaceV1,
  pkg: PredictivePackageV1,
  organizationId: string,
) {
  if (
    pkg.predictivePackageContentDigest.toString("hex") !==
      surface.selectedPackage.contentDigestHex ||
    pkg.predictivePackageGenerationIdentityDigest.toString("hex") !==
      surface.selectedPackage.generationDigestHex ||
    pkg.runtimeContractDigest.toString("hex") !==
      surface.selectedPackage.runtimeContractDigestHex ||
    pkg.terminalTargetGridIdentityDigestHex !== surface.selectedPackage.targetGridDigestHex ||
    pkg.kConfigDec !== surface.kmSelection.k ||
    pkg.mConfigDec !== surface.kmSelection.m ||
    pkg.family.organizationId !== organizationId ||
    pkg.family.symbol !== surface.symbol ||
    pkg.family.primaryHorizonMinutes !== surface.primaryHorizonMinutes
  )
    fail("SELECTED_PACKAGE");
}

function issueRows(input: {
  envelope: G1TrustedOriginMappingEnvelopeV1;
  surface: G1TrustedOriginSurfaceV1;
  pkg: PredictivePackageV1;
  offset: number;
  batch: readonly SourceAnchor[];
}): { rows: ForecastBatchRowV1[]; cacheInput: object } {
  const origin = input.envelope.mapping.O;
  const frozenBatch = Object.freeze(input.batch.map(freezeAnchor));
  if (
    input.offset < 0 ||
    input.offset % WF_FORECAST_BATCH_SIZE_V1 !== 0 ||
    frozenBatch.length < 1 ||
    frozenBatch.length > WF_FORECAST_BATCH_SIZE_V1
  )
    fail("BATCH");
  bindSelectedPackage(input.surface, input.pkg, origin.organizationId);
  const cacheInput = Object.freeze({
    organizationId: origin.organizationId,
    releaseSha: origin.releaseSha,
    generationDigest: input.surface.selectedPackage.generationDigestHex,
    packageDigest: input.surface.selectedPackage.contentDigestHex,
    evaluationPartitionReceiptDigestHex: input.surface.evaluationPartition.receiptDigestHex,
    offset: input.offset,
    batch: frozenBatch,
  });
  const rows = frozenBatch.map((anchor) => {
    const issuance = issueForecastV1({
      pkg: input.pkg,
      anchorClosedBarEpochMs: anchor.closedBarEpochMs,
      anchorRealizedVol20m_1m: anchor.realizedVol20m_1m,
      executionHorizonMinutes: input.pkg.family.executionHorizonMinutes,
      normalizationVersionDigestHex: input.pkg.family.normalizationVersionDigestHex,
    });
    return Object.freeze({
      anchorId: computeSemanticSha256Hex({
        schemaVersion: "waia.trader.wf_predictive_anchor.v2",
        surfaceKey: input.surface.surfaceKey,
        closedBarEpochMs: anchor.closedBarEpochMs,
        barContentDigest: anchor.barContentDigest,
        evaluationPartitionReceiptDigestHex: input.surface.evaluationPartition.receiptDigestHex,
      }),
      observedReturn: terminalRhFromOutcome13dV1(anchor.outcome13d),
      challengerProbabilities: issuance.terminalScenarioMasses.probabilities,
    });
  });
  return { rows: Object.freeze(rows), cacheInput };
}

export function hashForecastBatchRowsV1(rows: readonly ForecastBatchRowV1[]): string {
  return digest(serialize(rows));
}

export function issueControlForecastBatchV1(input: {
  envelope: G1TrustedOriginMappingEnvelopeV1;
  identity: MissingOnlyProducerIdentityV1;
  surfaceKey: G1TrustedOriginSurfaceV1["surfaceKey"];
  pkg: PredictivePackageV1;
  sourceCorpus: readonly SourceAnchor[];
  offset: number;
}) {
  refuseBuilderFallback(input);
  if (!input.pkg) fail("BUILDER_FALLBACK");
  const surface = input.envelope.mapping.surfaces.find(
    (entry) => entry.surfaceKey === input.surfaceKey,
  );
  if (!surface) fail("SURFACE");
  if (input.identity.producerGitSha === input.envelope.mapping.O.releaseSha) fail("O_P_COLLAPSE");
  const batch = input.sourceCorpus.slice(input.offset, input.offset + WF_FORECAST_BATCH_SIZE_V1);
  if (!batch.length) fail("BATCH");
  if (
    input.offset === 0 &&
    input.sourceCorpus.length >= WF_FORECAST_BATCH_SIZE_V1 &&
    batch.length !== WF_FORECAST_BATCH_SIZE_V1
  )
    fail("BATCH");
  const issued = issueRows({
    envelope: input.envelope,
    surface,
    pkg: input.pkg,
    offset: input.offset,
    batch,
  });
  return Object.freeze({
    authorityGranted: false,
    mode: "control" as const,
    identity: input.identity,
    surfaceKey: input.surfaceKey,
    offset: input.offset,
    rowCount: issued.rows.length,
    rows: issued.rows,
    rowsSha256: hashForecastBatchRowsV1(issued.rows),
    stage: WF_FORECAST_BATCH_STAGE_V1,
  });
}

export function issueMissingForecastBatchV1(input: {
  envelope: G1TrustedOriginMappingEnvelopeV1;
  identity: MissingOnlyProducerIdentityV1;
  origin: ReturnType<typeof createOriginReadOnlyPortV1>;
  journal: ProducerJournalV1;
  producerEvidenceRoot: string;
  surfaceKey: G1TrustedOriginSurfaceV1["surfaceKey"];
  pkg: PredictivePackageV1;
  sourceCorpus: readonly SourceAnchor[];
  offset: number;
  retryIncomplete?: boolean;
}) {
  refuseBuilderFallback(input);
  if (!input.pkg) fail("BUILDER_FALLBACK");
  const origin = input.envelope.mapping.O;
  if (input.identity.producerGitSha === origin.releaseSha) fail("O_P_COLLAPSE");
  const producerRoot = realpathSync(input.journal.root);
  if (
    producerRoot === input.origin.root ||
    realpathSync(input.producerEvidenceRoot) === input.origin.root
  )
    fail("ORIGIN_WRITE");
  const surface = input.envelope.mapping.surfaces.find(
    (entry) => entry.surfaceKey === input.surfaceKey,
  );
  if (!surface) fail("SURFACE");
  const missing = enumerateMissingWfForecastBatchesV1({
    envelope: input.envelope,
    surfaceKey: input.surfaceKey,
    sourceCorpus: input.sourceCorpus,
    origin: input.origin,
    journal: input.journal,
  });
  const target = missing.find((batch) => batch.offset === input.offset);
  if (!target) fail("NOT_MISSING");
  const batch = input.sourceCorpus.slice(input.offset, input.offset + WF_FORECAST_BATCH_SIZE_V1);
  if (batch.length !== target.anchorCount) fail("BATCH");
  input.journal.claim(input.surfaceKey, input.offset, input.retryIncomplete === true);
  const issued = issueRows({
    envelope: input.envelope,
    surface,
    pkg: input.pkg,
    offset: input.offset,
    batch,
  });
  const store = createScientificCheckpointStoreV1(
    input.producerEvidenceRoot,
    input.identity.producerGitSha,
  );
  const rows = withScientificCheckpointsV1(store, () =>
    reuseScientificEvidenceV1(WF_FORECAST_BATCH_STAGE_V1, issued.cacheInput, () => issued.rows),
  );
  const producerKey = deriveScientificCheckpointKeyV1({
    releaseSha: input.identity.producerGitSha,
    runtime: currentRuntime(),
    kind: "evidence",
    stage: WF_FORECAST_BATCH_STAGE_V1,
    input: issued.cacheInput,
  });
  const payloadDigest = digest(serialize(rows));
  input.journal.complete({
    surfaceKey: input.surfaceKey,
    offset: input.offset,
    originKey: target.originKey,
    producerKey,
    payloadDigest,
    rowsSha256: hashForecastBatchRowsV1(rows),
  });
  return Object.freeze({
    authorityGranted: false,
    surfaceKey: input.surfaceKey,
    offset: input.offset,
    rowCount: rows.length,
    originKey: target.originKey,
    producerKey,
    payloadDigest,
    rowsSha256: hashForecastBatchRowsV1(rows),
  });
}

export function parseProducerMappingInputV1(value: unknown): G1TrustedOriginMappingEnvelopeV1 {
  if (value == null) fail("MISSING_MAPPING");
  return parseG1TrustedOriginMappingEnvelopeV1(value);
}
