/**
 * DEE-436 — cross-phase reconnect baseline revalidation before Step 28.
 */

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  parseFhvT4ContinuitySnapshot,
  type FhvT4ContinuitySnapshotV1,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { parseFhvT4CompletedCampaignSystemdIdentity } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import {
  computeFhvT4ObserverSystemdIdentityDigest,
  parseFhvT4ObserverSystemdIdentity,
} from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import {
  parseFhvT4ObserverQualificationProof,
  type FhvT4ObserverQualificationProofV1,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import {
  buildDefaultRemoteFsOperation,
  type FhvT4aRemoteFsExistsOperation,
  type FhvT4aRemoteFsReadOperation,
  type FhvT4aRemoteFsSha256Operation,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-ops";
import {
  fhvT4aBindingDigest,
  fhvT4aFullBindingFields,
  type FhvT4aPostBeforeReceiptV1,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";

export type FhvT4aReconnectBaseline = Readonly<{
  postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
  preQualificationProof: FhvT4ObserverQualificationProofV1;
  continuityBefore: FhvT4ContinuitySnapshotV1;
  continuityBeforeDigest: string;
  observerIdentityDigest: string;
  campaignIdentityDigest: string;
}>;

function remoteFsBase(
  bindings: FhvT4aOperatorBindings,
  approvedRoots: readonly string[],
): {
  approvedRoots: readonly string[];
  pythonBin: string;
  serviceUser: string;
  locus: "REMOTE_ROOT";
} {
  return {
    approvedRoots,
    pythonBin: bindings.pythonBin,
    serviceUser: bindings.serviceUser,
    locus: "REMOTE_ROOT",
  };
}

export function revalidateFhvT4aReconnectBaseline(input: {
  bindings: FhvT4aOperatorBindings;
  transport: FhvT4aOperatorTransport;
  postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
}): FhvT4aReconnectBaseline {
  const { bindings, transport, postBeforeReceipt } = input;
  const expectedBindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));
  const fsBase = remoteFsBase(bindings, transport.approvedRemoteRoots);

  if (postBeforeReceipt.bindingDigest !== expectedBindingDigest) {
    throw new FhvT4aOperatorError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "POST before receipt binding digest mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.targetSha !== bindings.targetSha) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "targetSha mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.releaseTag !== bindings.releaseTag) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "releaseTag mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.runId !== bindings.runId) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "runId mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.organizationId !== bindings.organizationId) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "organizationId mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.execHost !== bindings.execHost) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "execHost mismatch at reconnect.",
    );
  }
  if (postBeforeReceipt.sshUser !== bindings.sshUser) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      "sshUser mismatch at reconnect.",
    );
  }

  const continuityExistsOp: FhvT4aRemoteFsExistsOperation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.continuityBeforePath,
  });
  if (!transport.remoteFileExists(continuityExistsOp)) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_MISSING",
      "continuity-before proof missing at reconnect.",
    );
  }
  const continuityShaOp: FhvT4aRemoteFsSha256Operation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.continuityBeforePath,
  });
  const continuityBeforeRemoteDigest = transport.remoteSha256(continuityShaOp);
  if (continuityBeforeRemoteDigest !== postBeforeReceipt.continuityBeforeDigest) {
    throw new FhvT4aOperatorError(
      "POST_BEFORE_CONTINUITY_DIGEST_NOT_REVALIDATED",
      "continuity-before digest mismatch at reconnect.",
    );
  }

  const preQualExistsOp: FhvT4aRemoteFsExistsOperation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.observerQualificationPrePath,
  });
  if (!transport.remoteFileExists(preQualExistsOp)) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_PRE_MISSING",
      "Pre-campaign qualification proof missing at reconnect.",
    );
  }
  const preQualShaOp: FhvT4aRemoteFsSha256Operation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.observerQualificationPrePath,
  });
  const preQualRemoteDigest = transport.remoteSha256(preQualShaOp);
  if (preQualRemoteDigest !== postBeforeReceipt.observerQualificationPreDigest) {
    throw new FhvT4aOperatorError(
      "PRE_QUALIFICATION_DIGEST_NOT_REVALIDATED",
      "Pre-campaign qualification proof digest mismatch at reconnect.",
    );
  }

  const preQualReadOp: FhvT4aRemoteFsReadOperation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.observerQualificationPrePath,
    byteCap: transport.remoteReadByteCap,
  });
  const preQualRaw = transport.readRemoteFile(preQualReadOp);
  let preQualificationProof: FhvT4ObserverQualificationProofV1;
  try {
    preQualificationProof = parseFhvT4ObserverQualificationProof(JSON.parse(preQualRaw));
  } catch (error) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (preQualificationProof.phase !== "PRE_CAMPAIGN") {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_PHASE_INVALID",
      "Pre-campaign qualification proof phase invalid.",
    );
  }
  if (
    preQualificationProof.runId !== bindings.runId ||
    preQualificationProof.organizationId !== bindings.organizationId ||
    preQualificationProof.targetSha !== bindings.targetSha
  ) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_IDENTITY_MISMATCH",
      "Pre-campaign qualification identity mismatch.",
    );
  }

  const continuityReadOp: FhvT4aRemoteFsReadOperation = buildDefaultRemoteFsOperation({
    ...fsBase,
    remotePath: postBeforeReceipt.continuityBeforePath,
    byteCap: transport.remoteReadByteCap,
  });
  const continuityBeforeRaw = transport.readRemoteFile(continuityReadOp);
  let continuityBefore: FhvT4ContinuitySnapshotV1;
  try {
    continuityBefore = parseFhvT4ContinuitySnapshot(JSON.parse(continuityBeforeRaw));
  } catch (error) {
    throw new FhvT4aOperatorError(
      "RECONNECT_CONTINUITY_NOT_STRICTLY_PARSED",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (continuityBefore.runId !== bindings.runId) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_RUN_MISMATCH",
      "continuity-before runId mismatch.",
    );
  }
  if (continuityBefore.organizationId !== bindings.organizationId) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_ORG_MISMATCH",
      "continuity-before organizationId mismatch.",
    );
  }
  if (continuityBefore.targetSha !== bindings.targetSha) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_SHA_MISMATCH",
      "continuity-before targetSha mismatch.",
    );
  }
  if (continuityBefore.capturePhase !== "before_disconnect") {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_PHASE_INVALID",
      "continuity-before capturePhase must be before_disconnect.",
    );
  }

  let observerIdentity;
  let campaignIdentity;
  try {
    observerIdentity = parseFhvT4ObserverSystemdIdentity(continuityBefore.observerSystemdIdentity);
    campaignIdentity = parseFhvT4CompletedCampaignSystemdIdentity(
      continuityBefore.campaignSystemdIdentity,
    );
  } catch (error) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_IDENTITY_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }

  const observerIdentityDigest = computeFhvT4ObserverSystemdIdentityDigest(observerIdentity);
  const campaignIdentityDigest = campaignIdentity.contentDigest;
  if (observerIdentityDigest !== postBeforeReceipt.observerIdentityDigest) {
    throw new FhvT4aOperatorError(
      "OBSERVER_BASELINE_DIGEST_UNUSED",
      "Observer identity digest mismatch versus continuity-before.",
    );
  }
  if (campaignIdentityDigest !== postBeforeReceipt.campaignIdentityDigest) {
    throw new FhvT4aOperatorError(
      "CROSS_PHASE_CAMPAIGN_BASELINE_NOT_PERSISTED",
      "Campaign identity digest mismatch versus continuity-before.",
    );
  }

  const { contentDigest, ...withoutDigest } = continuityBefore;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_DIGEST_INVALID",
      "continuity-before contentDigest invalid.",
    );
  }

  return {
    postBeforeReceipt,
    preQualificationProof,
    continuityBefore,
    continuityBeforeDigest: continuityBeforeRemoteDigest,
    observerIdentityDigest,
    campaignIdentityDigest,
  };
}
