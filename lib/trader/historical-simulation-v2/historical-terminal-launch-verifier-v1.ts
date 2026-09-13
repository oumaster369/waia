import type { HistoricalObservableProjectionV2 } from "./observable-read-model-v2";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import {
  buildHistoricalRehearsalStartedReceiptV1,
  buildHistoricalScientificAdmissionRefusalReceiptV1,
  buildRuntimeReleaseBindingReceiptDigestV1,
  isHistoricalTerminalFixtureIdentityV1,
  type HistoricalComparisonStatisticV1,
  type HistoricalRehearsalStartedReceiptV1,
  type HistoricalScientificAdmissionRefusalReceiptV1,
  type ScientificAdmissionRefusalReasonCodeV1,
} from "./historical-terminal-receipts-v1";
import type { HolmComparison } from "@/lib/trader/research/benchmark/holm-fwer-v1";

export const HISTORICAL_TERMINAL_ADMIN_OBSERVATION_PATH_V1 =
  "/api/trader/admin/historical-v2/stream" as const;
export const HISTORICAL_TERMINAL_TENANT_OBSERVATION_PATH_V1 =
  "/api/trader/historical-v2/stream" as const;

export type HistoricalTerminalObservationHttpResultV1 = Readonly<{
  status: number;
  authenticated: boolean;
  body: HistoricalObservableProjectionV2 | null;
}>;

export type HistoricalTerminalObservationHttpAdapterV1 = Readonly<{
  fetch(
    input: Readonly<{
      url: string;
      cookie: string;
      role: "admin" | "tenant";
    }>,
  ): Promise<HistoricalTerminalObservationHttpResultV1>;
}>;

export function historicalTerminalAdminObservationUrlV1(
  organizationId: string,
  runId: string,
): string {
  return `${HISTORICAL_TERMINAL_ADMIN_OBSERVATION_PATH_V1}?organization_id=${encodeURIComponent(organizationId)}&run_id=${encodeURIComponent(runId)}&transport=poll`;
}

export function historicalTerminalTenantObservationUrlV1(runId: string, accountId: string): string {
  return `${HISTORICAL_TERMINAL_TENANT_OBSERVATION_PATH_V1}?run_id=${encodeURIComponent(runId)}&account_id=${encodeURIComponent(accountId)}&transport=poll`;
}

export type HistoricalTerminalLineageRecordV1 = Readonly<{
  id: string;
  contentDigestHex: string;
  releaseSha: string;
}>;

export type HistoricalTerminalLaunchFactsV1 = Readonly<{
  releaseSha: string;
  organizationId: string;
  accountId: string;
  runId: string;
  tenantUserId: string;
  proposals: readonly HistoricalTerminalLineageRecordV1[];
  ratifications: readonly HistoricalTerminalLineageRecordV1[];
  fourSurfaceAuthorities: readonly HistoricalTerminalLineageRecordV1[];
  acceptedClaims: readonly Readonly<{ claimantId: string }>[];
  leaseAcquired: boolean;
  lifecycle: Readonly<{
    phase: string;
    contentDigestHex: string;
    releaseSha?: string;
  }>;
  health: Readonly<{
    status: string;
    releaseSha: string;
    imageReleaseSha: string;
    runId: string | null;
  }> | null;
  statistics: readonly HistoricalComparisonStatisticV1[];
  holmComparisons: readonly HolmComparison[];
  adminCookie?: string;
  tenantCookie?: string;
}>;

export type HistoricalTerminalLaunchPassV1 = Readonly<{
  status: "PASS";
  marker: `HISTORICAL_REHEARSAL_STARTED=PASS receipt=${string}`;
  receipt: HistoricalRehearsalStartedReceiptV1;
}>;

export type HistoricalTerminalLaunchRefusedV1 = Readonly<{
  status: "REFUSED";
  marker: `SCIENTIFIC_ADMISSION_REFUSED=${ScientificAdmissionRefusalReasonCodeV1}:${string}`;
  receipt: HistoricalScientificAdmissionRefusalReceiptV1;
  reasonCode: ScientificAdmissionRefusalReasonCodeV1;
}>;

export type HistoricalTerminalLaunchResultV1 =
  | HistoricalTerminalLaunchPassV1
  | HistoricalTerminalLaunchRefusedV1;

function formatPassMarker(digest: string): HistoricalTerminalLaunchPassV1["marker"] {
  return `HISTORICAL_REHEARSAL_STARTED=PASS receipt=${digest}`;
}

function formatRefusedMarker(
  reason: ScientificAdmissionRefusalReasonCodeV1,
  digest: string,
): HistoricalTerminalLaunchRefusedV1["marker"] {
  return `SCIENTIFIC_ADMISSION_REFUSED=${reason}:${digest}`;
}

function accountHead(projection: HistoricalObservableProjectionV2, accountId: string) {
  return projection.accounts.find((account) => account.accountId === accountId) ?? null;
}

function observationParityRefused(
  admin: HistoricalObservableProjectionV2,
  tenant: HistoricalObservableProjectionV2,
  expected: Readonly<{ organizationId: string; runId: string; accountId: string }>,
): ScientificAdmissionRefusalReasonCodeV1 | null {
  if (
    admin.organizationId !== expected.organizationId ||
    tenant.organizationId !== expected.organizationId ||
    admin.runId !== expected.runId ||
    tenant.runId !== expected.runId
  ) {
    return "CROSS_RUN_OBSERVATION";
  }
  if (
    !admin.lifecycle ||
    !tenant.lifecycle ||
    admin.lifecycle.contentDigestHex !== tenant.lifecycle.contentDigestHex
  ) {
    return "CROSS_RUN_OBSERVATION";
  }
  const adminAccount = accountHead(admin, expected.accountId);
  const tenantAccount = accountHead(tenant, expected.accountId);
  if (!adminAccount || !tenantAccount) return "MISSING_TENANT_OBSERVATION";
  if (
    adminAccount.accountId !== tenantAccount.accountId ||
    adminAccount.ledgerHeadContentDigestHex !== tenantAccount.ledgerHeadContentDigestHex ||
    adminAccount.cycleSequence !== tenantAccount.cycleSequence ||
    adminAccount.cycleId !== tenantAccount.cycleId
  ) {
    return "CROSS_RUN_OBSERVATION";
  }
  return null;
}

async function proveAuthenticatedObservation(
  facts: HistoricalTerminalLaunchFactsV1,
  adapter: HistoricalTerminalObservationHttpAdapterV1 | undefined,
): Promise<
  | ScientificAdmissionRefusalReasonCodeV1
  | Readonly<{
      admin: HistoricalObservableProjectionV2;
      tenant: HistoricalObservableProjectionV2;
    }>
> {
  if (!adapter) return "OBSERVATION_ADAPTER_MISSING";
  if (!facts.adminCookie || !facts.tenantCookie) return "UNAUTHENTICATED_OBSERVATION";
  const admin = await adapter.fetch({
    url: historicalTerminalAdminObservationUrlV1(facts.organizationId, facts.runId),
    cookie: facts.adminCookie,
    role: "admin",
  });
  if (admin.status === 401 || admin.status === 403 || !admin.authenticated) {
    return "UNAUTHENTICATED_OBSERVATION";
  }
  if (admin.status !== 200 || !admin.body) return "MISSING_ADMIN_OBSERVATION";
  const tenant = await adapter.fetch({
    url: historicalTerminalTenantObservationUrlV1(facts.runId, facts.accountId),
    cookie: facts.tenantCookie,
    role: "tenant",
  });
  if (tenant.status === 401 || tenant.status === 403 || !tenant.authenticated) {
    return "UNAUTHENTICATED_OBSERVATION";
  }
  if (tenant.status !== 200 || !tenant.body) return "MISSING_TENANT_OBSERVATION";
  const mismatch = observationParityRefused(admin.body, tenant.body, facts);
  if (mismatch) return mismatch;
  return { admin: admin.body, tenant: tenant.body };
}

/**
 * Sole terminal verifier. Operational interruption never reaches this function,
 * so a lost SSH or Cursor session is not a terminal state.
 */
export async function verifyHistoricalTerminalLaunchV1(
  facts: HistoricalTerminalLaunchFactsV1,
  deps: Readonly<{
    observation?: HistoricalTerminalObservationHttpAdapterV1;
  }> = {},
): Promise<HistoricalTerminalLaunchResultV1> {
  const refuse = (
    reasonCode: ScientificAdmissionRefusalReasonCodeV1,
  ): HistoricalTerminalLaunchRefusedV1 => {
    const receipt = buildHistoricalScientificAdmissionRefusalReceiptV1({
      releaseSha: facts.releaseSha,
      organizationId: facts.organizationId,
      runId: facts.runId,
      reasonCode,
      statistics: facts.statistics,
      holmComparisons: facts.holmComparisons,
    });
    return Object.freeze({
      status: "REFUSED",
      reasonCode,
      receipt,
      marker: formatRefusedMarker(reasonCode, receipt.contentDigestHex),
    });
  };

  if (isHistoricalTerminalFixtureIdentityV1(facts)) return refuse("FIXTURE_IDENTITY");
  if (personalOrganizationIdFromUserId(facts.tenantUserId) !== facts.organizationId) {
    return refuse("ORGANIZATION_SCOPE");
  }
  if (facts.proposals.length !== 1) return refuse("MISSING_PROPOSAL");
  if (facts.ratifications.length !== 1) return refuse("MISSING_RATIFICATION");
  if (facts.fourSurfaceAuthorities.length !== 1) return refuse("MISSING_FOUR_SURFACE_AUTHORITY");
  const proposal = facts.proposals[0]!;
  const ratification = facts.ratifications[0]!;
  const authority = facts.fourSurfaceAuthorities[0]!;
  const releases = [
    facts.releaseSha,
    proposal.releaseSha,
    ratification.releaseSha,
    authority.releaseSha,
    facts.lifecycle.releaseSha ?? facts.releaseSha,
    facts.health?.releaseSha,
    facts.health?.imageReleaseSha,
  ];
  if (releases.some((value) => value !== facts.releaseSha)) return refuse("RELEASE_MISMATCH");
  if (!facts.leaseAcquired || facts.acceptedClaims.length !== 1)
    return refuse("CONCURRENT_CLAIMANT");
  const lifecyclePhase = facts.lifecycle.phase;
  if (lifecyclePhase !== "RUNNING" && lifecyclePhase !== "COMPLETED") {
    return refuse("WRONG_LIFECYCLE");
  }
  if (!facts.health || facts.health.status !== "ok" || facts.health.runId !== facts.runId) {
    return refuse("HEALTH_MISMATCH");
  }
  const observed = await proveAuthenticatedObservation(facts, deps.observation);
  if (typeof observed === "string") return refuse(observed);
  const adminAccount = accountHead(observed.admin, facts.accountId)!;
  const tenantAccount = accountHead(observed.tenant, facts.accountId)!;
  const receipt = buildHistoricalRehearsalStartedReceiptV1({
    releaseSha: facts.releaseSha,
    runtimeReleaseBindingReceiptDigestHex: buildRuntimeReleaseBindingReceiptDigestV1(
      facts.releaseSha,
    ),
    organizationId: facts.organizationId,
    accountId: facts.accountId,
    runId: facts.runId,
    proposalId: proposal.id,
    proposalContentDigestHex: proposal.contentDigestHex,
    ratificationId: ratification.id,
    ratificationContentDigestHex: ratification.contentDigestHex,
    fourSurfaceAuthorityId: authority.id,
    fourSurfaceAuthorityContentDigestHex: authority.contentDigestHex,
    consumerClaim: {
      claimantId: facts.acceptedClaims[0]!.claimantId,
      accepted: true,
      concurrentClaimantCount: 0,
    },
    lease: {
      leaseKey: `waia:historical-simulation-v2:consumer:${facts.organizationId}:${facts.runId}`,
      acquired: true,
    },
    lifecycle: {
      phase: lifecyclePhase,
      contentDigestHex: facts.lifecycle.contentDigestHex,
    },
    imageHealthBinding: {
      releaseSha: facts.health.releaseSha,
      imageReleaseSha: facts.health.imageReleaseSha,
      runId: facts.runId,
      status: "ok",
    },
    adminObservationBinding: {
      organizationId: facts.organizationId,
      runId: facts.runId,
      lifecycleContentDigestHex: observed.admin.lifecycle!.contentDigestHex,
      accountId: adminAccount.accountId,
      ledgerHeadContentDigestHex: adminAccount.ledgerHeadContentDigestHex,
      cycleSequence: adminAccount.cycleSequence,
      cycleId: adminAccount.cycleId,
    },
    tenantObservationBinding: {
      organizationId: facts.organizationId,
      runId: facts.runId,
      accountId: tenantAccount.accountId,
      lifecycleContentDigestHex: observed.tenant.lifecycle!.contentDigestHex,
      ledgerHeadContentDigestHex: tenantAccount.ledgerHeadContentDigestHex,
      cycleSequence: tenantAccount.cycleSequence,
      cycleId: tenantAccount.cycleId,
    },
  });
  return Object.freeze({
    status: "PASS",
    receipt,
    marker: formatPassMarker(receipt.contentDigestHex),
  });
}
