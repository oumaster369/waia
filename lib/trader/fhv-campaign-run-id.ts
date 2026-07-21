/** Campaign run ID validation for FHV admin operations (DEE-416 runtime integrity). */

export const FHV_CAMPAIGN_RUN_ID_MAX_LENGTH = 128;
export const FHV_CAMPAIGN_RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export class FhvCampaignRunIdError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FhvCampaignRunIdError";
    this.code = code;
  }
}

export function validateFhvCampaignRunId(runId: string): string {
  const trimmed = runId.trim();
  if (!trimmed) {
    throw new FhvCampaignRunIdError("CAMPAIGN_RUN_ID_REQUIRED", "campaign_run_id is required.");
  }
  if (trimmed.length > FHV_CAMPAIGN_RUN_ID_MAX_LENGTH) {
    throw new FhvCampaignRunIdError("CAMPAIGN_RUN_ID_TOO_LONG", "campaign_run_id is too long.");
  }
  if (!FHV_CAMPAIGN_RUN_ID_PATTERN.test(trimmed)) {
    throw new FhvCampaignRunIdError(
      "CAMPAIGN_RUN_ID_INVALID",
      "campaign_run_id format is invalid.",
    );
  }
  return trimmed;
}

export function buildFhvAdminStatusPath(organizationId: string, campaignRunId: string): string {
  return (
    `/api/trader/admin/fhv-operations/status` +
    `?organization_id=${encodeURIComponent(organizationId)}` +
    `&campaign_run_id=${encodeURIComponent(campaignRunId)}`
  );
}

export function buildFhvAdminDetailPath(
  organizationId: string,
  campaignRunId: string,
  kind: string,
): string {
  return (
    `/api/trader/admin/fhv-operations/detail` +
    `?organization_id=${encodeURIComponent(organizationId)}` +
    `&campaign_run_id=${encodeURIComponent(campaignRunId)}` +
    `&kind=${encodeURIComponent(kind)}`
  );
}

export function buildFhvAdminCommandPath(organizationId: string, campaignRunId: string): string {
  return (
    `/api/trader/admin/fhv-operations/commands` +
    `?organization_id=${encodeURIComponent(organizationId)}` +
    `&campaign_run_id=${encodeURIComponent(campaignRunId)}`
  );
}
