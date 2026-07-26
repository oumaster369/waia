/**
 * DEE-436 — cross-phase reconnect baseline revalidation before Step 28.
 */

import { createHash } from "node:crypto";

import {
  parseFhvT4ObserverQualificationProof,
  type FhvT4ObserverQualificationProofV1,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import {
  fhvT4aBindingDigest,
  fhvT4aFullBindingFields,
  type FhvT4aPostBeforeReceiptV1,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type FhvT4aReconnectBaseline = Readonly<{
  postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
  preQualificationProof: FhvT4ObserverQualificationProofV1;
  continuityBeforeDigest: string;
  observerIdentityDigest: string;
  campaignIdentityDigest: string;
}>;

export function revalidateFhvT4aReconnectBaseline(input: {
  bindings: FhvT4aOperatorBindings;
  transport: FhvT4aOperatorTransport;
  postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
}): FhvT4aReconnectBaseline {
  const { bindings, transport, postBeforeReceipt } = input;
  const expectedBindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));

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

  if (!transport.remoteFileExists(postBeforeReceipt.continuityBeforePath)) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_MISSING",
      "continuity-before proof missing at reconnect.",
    );
  }
  const continuityBeforeRemoteDigest = transport.remoteSha256(
    postBeforeReceipt.continuityBeforePath,
  );
  if (continuityBeforeRemoteDigest !== postBeforeReceipt.continuityBeforeDigest) {
    throw new FhvT4aOperatorError(
      "POST_BEFORE_CONTINUITY_DIGEST_NOT_REVALIDATED",
      "continuity-before digest mismatch at reconnect.",
    );
  }

  if (!transport.remoteFileExists(postBeforeReceipt.observerQualificationPrePath)) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_PRE_MISSING",
      "Pre-campaign qualification proof missing at reconnect.",
    );
  }
  const preQualRemoteDigest = transport.remoteSha256(
    postBeforeReceipt.observerQualificationPrePath,
  );
  if (preQualRemoteDigest !== postBeforeReceipt.observerQualificationPreDigest) {
    throw new FhvT4aOperatorError(
      "PRE_QUALIFICATION_DIGEST_NOT_REVALIDATED",
      "Pre-campaign qualification proof digest mismatch at reconnect.",
    );
  }

  const preQualRaw = transport.readRemoteFile(postBeforeReceipt.observerQualificationPrePath);
  const preQualificationProof = parseFhvT4ObserverQualificationProof(JSON.parse(preQualRaw));
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

  const continuityBeforeRaw = transport.readRemoteFile(postBeforeReceipt.continuityBeforePath);
  const continuityBefore = JSON.parse(continuityBeforeRaw) as {
    observerSystemdIdentity?: unknown;
    campaignSystemdIdentity?: { contentDigest?: string };
  };
  if (
    !continuityBefore.observerSystemdIdentity ||
    !continuityBefore.campaignSystemdIdentity?.contentDigest
  ) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CONTINUITY_BEFORE_INVALID",
      "continuity-before missing identity fields.",
    );
  }
  const observerIdentityDigest = sha256Hex(
    JSON.stringify(continuityBefore.observerSystemdIdentity),
  );
  const campaignIdentityDigest = continuityBefore.campaignSystemdIdentity.contentDigest;
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

  return {
    postBeforeReceipt,
    preQualificationProof,
    continuityBeforeDigest: continuityBeforeRemoteDigest,
    observerIdentityDigest,
    campaignIdentityDigest,
  };
}
