import { constants, closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  assertMetadataBytesSupported,
  readMetadataTextSync,
} from "@/lib/trader/backtest/streaming-evidence/bounded-metadata-read";
import {
  FHV_CONTROL_REPLAY_METADATA_OPTIONS as profile,
  readFhvControlReplayAuthorizationTransitionV1,
  resolveFhvControlReplayHistoryDirectory,
  type FhvControlReplayTransitionInput,
  type FhvFullHistoricalAuthorizationReceiptV1,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  readFhvFullLaunchReceipt,
  resolveFhvFullLaunchRunDirectory,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvOfficialCampaignIdentity } from "@/lib/trader/observability/fhv-official-campaign-identity";
import {
  buildFhvLaunchJournal,
  readFhvLaunchJournal,
} from "@/lib/trader/observability/fhv-launch-journal";
import {
  readFhvAuthorizationClaim,
  readFhvTerminalResult,
  resolveFhvAuthorizationClaimPath,
  validateAuthorizationClaimDigest,
  type FhvAuthorizationClaimV2,
  type FhvAuthorizationClaimExpectedIdentity,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { computeFhvCycleZeroCheckpointDigest } from "@/lib/trader/observability/fhv-execution-checkpoint";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export class FhvControlReplayTransitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvControlReplayTransitionError";
  }
}
function refuse(code: string, message: string): never {
  throw new FhvControlReplayTransitionError(code, message);
}
const zeros = "0".repeat(64);
const emptyDigest = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

export function resolveFhvControlReplayRunDirectory(input: {
  artifactRoot: string;
  runId: string;
  runDir?: string;
}): string {
  resolveFhvControlReplayHistoryDirectory(input.artifactRoot, input.runId);
  const runDir = resolve(resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId));
  if (input.runDir !== undefined && resolve(input.runDir) !== runDir)
    refuse(
      "CONTROL_REPLAY_RUN_DIRECTORY_MISMATCH",
      "Control Replay run directory must match artifactRoot/runId.",
    );
  return runDir;
}

/** Phase-limited local ownership; not an active-driver lease or exclusion proof. */
export function claimFhvControlReplayInitializationLock(runDir: string) {
  const path = join(runDir, "control", ".authorization-initialization.lock");
  try {
    return { path, fd: claimFileExclusiveLock(path) };
  } catch (error) {
    if ((error as { code?: string }).code === "EXCLUSIVE_LOCK_HELD")
      refuse(
        "INITIALIZATION_OWNERSHIP_UNRESOLVED",
        "Control Replay initialization ownership is unresolved; no automatic lock removal.",
      );
    throw error;
  }
}
export function releaseFhvControlReplayInitializationLock(lock: {
  path: string;
  fd: number;
}): void {
  releaseFileExclusiveLock(lock.path, lock.fd);
}

export function expectedFhvControlReplayClaimIdentity(
  issued: FhvFullHistoricalAuthorizationReceiptV1,
): FhvAuthorizationClaimExpectedIdentity {
  return {
    authorizationReceiptDigest: issued.authorizationReceiptDigest,
    executionPurpose: "CONTROL_REPLAY",
    runId: issued.runId,
    releaseSha: issued.releaseSha,
    datasetContentDigest: issued.datasetDigest,
    manifestSemanticDigest: issued.manifestDigest,
    configurationFreezeDigest: issued.configurationFreezeDigest,
    controlReplayReceiptDigest: undefined,
  };
}
function assertClaimIdentity(
  claim: FhvAuthorizationClaimV2,
  issued: FhvFullHistoricalAuthorizationReceiptV1,
): void {
  validateAuthorizationClaimDigest(claim);
  const expected = expectedFhvControlReplayClaimIdentity(issued);
  if (
    claim.schemaVersion !== "fhv-authorization-claim/v2" ||
    Object.entries(expected).some(
      ([key, value]) => claim[key as keyof FhvAuthorizationClaimV2] !== value,
    )
  )
    refuse("CLAIM_IDENTITY_MISMATCH", "Native claim must bind original Ai.");
}

function nativeInitializationProducts(input: FhvControlReplayTransitionInput) {
  const transition = readFhvControlReplayAuthorizationTransitionV1(input);
  const runDir = resolveFhvControlReplayRunDirectory(input);
  const paths = {
    launch: join(runDir, "fhv-full-launch-receipt.v1.json"),
    campaign: join(runDir, "fhv-official-campaign-identity.v1.json"),
    claim: resolveFhvAuthorizationClaimPath(runDir),
    journal: join(runDir, "fhv-launch-journal.v1.json"),
    wal: join(runDir, "execution.wal.ndjson"),
  };
  if (Object.values(paths).some((path) => !existsSync(path)))
    refuse(
      "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
      "Native initialization prerequisites are missing.",
    );
  const launch = readFhvFullLaunchReceipt(paths.launch, profile);
  const campaign = readFhvOfficialCampaignIdentity(runDir, profile);
  const claim = readFhvAuthorizationClaim(paths.claim, profile);
  const journal = readFhvLaunchJournal(runDir, profile);
  const ai = transition.issued;
  const freeze = launch.configurationFreeze;
  if (
    launch.schemaVersion !== "fhv-full-launch-receipt/v1" ||
    launch.authorizationReceiptDigest !== ai.authorizationReceiptDigest ||
    launch.datasetQualificationReceiptDigest !== ai.datasetQualificationReceiptDigest ||
    !freeze ||
    freeze.configurationFreezeDigest !== ai.configurationFreezeDigest ||
    freeze.datasetDigest !== ai.datasetDigest ||
    freeze.manifestDigest !== ai.manifestDigest ||
    freeze.releaseSha !== ai.releaseSha ||
    freeze.runId !== ai.runId ||
    freeze.organizationId !== ai.organizationId ||
    freeze.operatorId !== ai.operatorId ||
    (freeze.releaseTag !== undefined && freeze.releaseTag !== ai.releaseTag)
  )
    refuse(
      "AUTHORIZATION_HISTORY_CONFLICT",
      "Launch receipt must bind original Ai and frozen identity.",
    );
  if (
    campaign.runId !== ai.runId ||
    campaign.organizationId !== ai.organizationId ||
    campaign.releaseSha !== ai.releaseSha ||
    campaign.launchReceiptDigest !== launch.launchReceiptDigest
  )
    refuse("AUTHORIZATION_HISTORY_CONFLICT", "Native campaign identity conflicts with launch.");
  assertClaimIdentity(claim, ai);
  if (
    journal.schemaVersion !== "fhv-launch-journal/v1" ||
    journal.runId !== ai.runId ||
    resolve(journal.walPath) !== paths.wal
  )
    refuse("AUTHORIZATION_HISTORY_CONFLICT", "Native journal identity conflicts with run.");
  return { transition, runDir, paths, launch, campaign, claim, journal };
}

function assertInitialClaim(
  claim: FhvAuthorizationClaimV2,
  issued: FhvFullHistoricalAuthorizationReceiptV1,
): void {
  assertClaimIdentity(claim, issued);
  if (
    claim.state !== "RUNNING" ||
    claim.fencingGeneration !== 1 ||
    claim.lastCommittedEpoch !== -1 ||
    claim.lastCommittedCycle !== -1 ||
    claim.checkpointDigest !== zeros ||
    claim.walCommitDigest !== zeros ||
    claim.terminalResultDigest !== undefined ||
    claim.cycleZeroCheckpointDigest !==
      computeFhvCycleZeroCheckpointDigest({
        runId: issued.runId,
        executionPurpose: "CONTROL_REPLAY",
        configurationFreezeDigest: issued.configurationFreezeDigest,
      })
  )
    refuse(
      "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
      "Initialization requires native cycle-zero RUNNING claim.",
    );
}
function assertRegularWal(path: string, initial: boolean): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile())
      refuse("AUTHORIZATION_INITIALIZATION_INCOMPLETE", "Native WAL must be a regular file.");
    if (initial && (info.size !== 0 || readSync(fd, Buffer.alloc(1), 0, 1, 0) !== 0))
      refuse(
        "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
        "Initial WAL must contain exactly empty bytes.",
      );
  } finally {
    closeSync(fd);
  }
}
function buildInitialized(
  products: ReturnType<typeof nativeInitializationProducts>,
  initialClaim: FhvAuthorizationClaimV2,
) {
  const body = {
    schemaVersion: "fhv-control-replay-initialized/v1" as const,
    profile: profile.metadataReadProfile,
    runId: products.transition.issued.runId,
    pairDigest: products.transition.pair.pairDigest,
    launchReceiptDigest: products.launch.launchReceiptDigest,
    campaignIdentityDigest: products.campaign.identityDigest,
    initialClaim,
    initialJournal: buildFhvLaunchJournal({
      runId: products.transition.issued.runId,
      walPath: products.paths.wal,
    }),
    initialWal: {
      relativePath: "execution.wal.ndjson" as const,
      bytes: 0 as const,
      bytesSha256: emptyDigest,
    },
  };
  return { ...body, initializedDigest: computeStableJsonDigest(body) };
}

export function publishFhvControlReplayInitializedTransitionV1(
  input: FhvControlReplayTransitionInput,
) {
  const products = nativeInitializationProducts(input);
  assertInitialClaim(products.claim, products.transition.issued);
  const initialJournal = buildFhvLaunchJournal({ runId: input.runId, walPath: products.paths.wal });
  if (computeStableJsonDigest(initialJournal) !== computeStableJsonDigest(products.journal))
    refuse(
      "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
      "Initial journal must be at cycle-zero frontier.",
    );
  assertRegularWal(products.paths.wal, true);
  const initialized = buildInitialized(products, products.claim);
  const bytes = Buffer.from(`${JSON.stringify(initialized, null, 2)}\n`);
  assertMetadataBytesSupported(bytes, profile);
  const path = join(products.transition.historyDir, "initialized.v1.json");
  if (existsSync(path))
    refuse("AUTHORIZATION_HISTORY_CONFLICT", "Initialization marker already exists.");
  // This publishes completed initialization, not a power-loss or current-checkpoint proof.
  writeFileAtomicExclusive(path, bytes);
  return assertFhvControlReplayInitializedTransitionV1(input);
}

export function assertFhvControlReplayInitializedTransitionV1(
  input: FhvControlReplayTransitionInput,
) {
  const historyDir = resolveFhvControlReplayHistoryDirectory(input.artifactRoot, input.runId);
  // Check Ai first so history-less consumed receipts are never reverse engineered.
  const transition = readFhvControlReplayAuthorizationTransitionV1(input);
  const markerPath = join(historyDir, "initialized.v1.json");
  if (!existsSync(markerPath))
    refuse(
      "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
      "Initialization marker is unavailable; no automatic repair.",
    );
  const marker = JSON.parse(readMetadataTextSync(markerPath, profile)) as ReturnType<
    typeof buildInitialized
  >;
  const products = nativeInitializationProducts(input);
  if (!marker.initialClaim)
    refuse(
      "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
      "Initial native claim snapshot is unavailable.",
    );
  assertInitialClaim(marker.initialClaim, transition.issued);
  const expected = buildInitialized(products, marker.initialClaim);
  if (computeStableJsonDigest(marker) !== computeStableJsonDigest(expected))
    refuse("AUTHORIZATION_HISTORY_CONFLICT", "Initialization marker identity or digest conflicts.");
  assertRegularWal(products.paths.wal, false);
  return { ...products, initialized: marker };
}

/** No reconciliation, checkpoint-bundle traversal or synthesized terminal result. */
export function readFhvControlReplayTerminalLinkV1(input: FhvControlReplayTransitionInput) {
  const products = assertFhvControlReplayInitializedTransitionV1(input);
  const before = readFhvAuthorizationClaim(products.paths.claim, profile);
  assertClaimIdentity(before, products.transition.issued);
  if (before.state !== "RUNNING" && before.state !== "COMPLETED")
    refuse(
      "TERMINAL_CLAIM_STATE_UNSUPPORTED",
      "Terminal observation requires a RUNNING or COMPLETED native claim.",
    );
  const path = join(products.runDir, "control", "fhv-terminal-result.v1.json");
  const terminal = existsSync(path) ? readFhvTerminalResult(path, profile) : undefined;
  if (
    terminal &&
    (terminal.schemaVersion !== "fhv-terminal-result/v1" || terminal.runId !== input.runId)
  )
    refuse("TERMINAL_IDENTITY_MISMATCH", "Native terminal identity conflicts with run.");
  const after = readFhvAuthorizationClaim(products.paths.claim, profile);
  assertClaimIdentity(after, products.transition.issued);
  if (after.authorizationClaimDigest !== before.authorizationClaimDigest)
    refuse(
      "AUTHORIZATION_CLAIM_READ_CHANGED",
      "Native full claim content changed during terminal read.",
    );
  if (
    before.state === "COMPLETED" &&
    (!terminal || before.terminalResultDigest !== terminal.terminalResultDigest)
  )
    refuse(
      "TERMINAL_COMPLETION_EVIDENCE_MISMATCH",
      "COMPLETED claim lacks its exact native terminal evidence.",
    );
  return {
    status: !terminal
      ? ("TERMINAL_NOT_AVAILABLE" as const)
      : before.state === "COMPLETED"
        ? ("TERMINAL_LINKED" as const)
        : ("TERMINAL_PENDING_CLAIM_COMMIT" as const),
    issuedAuthorizationReceiptDigest: products.transition.issued.authorizationReceiptDigest,
    consumedAuthorizationReceiptDigest: products.transition.consumed.authorizationReceiptDigest,
    authorizationClaimDigest: before.authorizationClaimDigest,
    ...(terminal ? { terminalResultDigest: terminal.terminalResultDigest } : {}),
    observedClaimFrontier: {
      fencingGeneration: before.fencingGeneration,
      lastCommittedEpoch: before.lastCommittedEpoch,
      lastCommittedCycle: before.lastCommittedCycle,
    },
    checkpointEvidence: "NOT_ASSESSED" as const,
  };
}

export function assertFhvControlReplayFreshInitialization(
  input: FhvControlReplayTransitionInput,
): void {
  const runDir = resolveFhvControlReplayRunDirectory(input);
  const historyDir = resolveFhvControlReplayHistoryDirectory(input.artifactRoot, input.runId);
  if (existsSync(`${resolveFhvAuthorizationClaimPath(runDir)}.claim.lock`))
    refuse("CLAIM_OWNERSHIP_UNRESOLVED", "Native claim lock exists; no automatic lock removal.");
  for (const path of [
    join(runDir, "fhv-full-launch-receipt.v1.json"),
    join(runDir, "fhv-official-campaign-identity.v1.json"),
    resolveFhvAuthorizationClaimPath(runDir),
    join(runDir, "fhv-launch-journal.v1.json"),
    join(runDir, "execution.wal.ndjson"),
    ...["consumed.v1.json", "pair.v1.json", "initialized.v1.json"].map((name) =>
      join(historyDir, name),
    ),
  ]) {
    if (existsSync(path))
      refuse(
        "AUTHORIZATION_INITIALIZATION_INCOMPLETE",
        "Existing native initialization/history cannot be silently repaired or reused.",
      );
  }
  // A matching pre-consume issued snapshot is handled exclusively by the consume owner.
}
