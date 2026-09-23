import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  handleAccountObservationGet,
  type ObservationReadDependencies,
} from "@/lib/trader/account-observation/read-handler";
import { createAccountObservationRouteDependencies } from "@/lib/trader/account-observation/route";
import { createPostgresRuntimeAuthorityAssessmentRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";
import { createSqliteRuntimeAuthorityAssessmentRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-sqlite-v2";
import {
  readLatestTenantRuntimeAuthorityV2,
  type RuntimeAuthorityReadModelV2,
} from "@/lib/trader/runtime-authority/v2/runtime-authority-read-model-v2";
import { readAdminRelease } from "@/lib/trader/admin-console/release";

export const ADMIN_COCKPIT_SOURCES = {
  releaseIdentityMissing: "missing:admin-release-identity-read-model",
  runtimeAuthority: "runtime-authority-read-model-v2",
  observationFreshness: "account-observation.readLatest",
  c3Channel: "fhv-or-historical-v2-observation-channel",
  c3MissingRun: "missing:operator-selected-campaign-run-id",
  c3TypedRunOnly:
    "operator-typed-campaign-run-id;progress-not-read-from-fhv-or-historical-v2-channel",
} as const;

const OBSERVATION_KEYS = [
  "credentialId",
  "exchangeAccountId",
  "credentialRevision",
  "configurationRevision",
] as const;

export type CockpitAsOf =
  | { readonly state: "known"; readonly at: string | number }
  | { readonly state: "unknown" };

export const COCKPIT_AS_OF_UNKNOWN: CockpitAsOf = { state: "unknown" };

export type CockpitValue<T> = {
  readonly state: "value";
  readonly source: string;
  readonly asOf: CockpitAsOf;
  readonly value: T;
};

export type CockpitUnavailable = {
  readonly state: "unavailable";
  readonly source: string;
  readonly asOf: CockpitAsOf;
  readonly operatorCampaignRunId?: string;
};

export type CockpitFact<T> = CockpitValue<T> | CockpitUnavailable;

export type AdminCockpitRuntimeValue = {
  readonly availability: RuntimeAuthorityReadModelV2["availability"];
  readonly organizationId: string;
  readonly runtimeInstanceId: string;
  readonly posture: RuntimeAuthorityReadModelV2["posture"];
  readonly reasonCodes: readonly string[];
  readonly assessmentId: string | null;
  readonly adjudicatedAtUtc: string | null;
};

export type ObservationFreshnessReading = {
  readonly organizationId: string;
  readonly collectionCompletedAtMs: number;
};

export type C3ChannelReading = {
  readonly organizationId: string;
  readonly campaignRunId: string;
  readonly progress: unknown;
  /** Present only when the existing channel itself reports a time. */
  readonly sourceAsOf?: string | null;
};

type RuntimeDb = Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>;

export type AdminCockpitReadDeps = AdminRouteHandlerDeps & {
  readRuntimeAuthority?: (
    organizationId: string,
    runtime: RuntimeDb,
  ) => Promise<RuntimeAuthorityReadModelV2>;
  readObservationFreshness?: (
    request: Request,
    organizationId: string,
  ) => Promise<ObservationFreshnessReading | null>;
  readC3Progress?: (input: {
    organizationId: string;
    campaignRunId: string;
  }) => Promise<C3ChannelReading | null>;
};

function asOfFromSource(at: string | number | null | undefined): CockpitAsOf {
  if (typeof at === "number" && Number.isFinite(at)) {
    return { state: "known", at };
  }
  if (typeof at === "string" && at.trim() !== "") {
    return { state: "known", at };
  }
  return COCKPIT_AS_OF_UNKNOWN;
}

export function cockpitReleaseFact(): CockpitFact<{
  sha: string;
  verified: false;
  reason: "RELEASE_SHA_UNVERIFIED";
}> {
  const release = readAdminRelease();
  if (release.state === "unavailable") {
    return {
      state: "unavailable",
      source: release.reason,
      asOf: COCKPIT_AS_OF_UNKNOWN,
    };
  }
  return {
    state: "value",
    source: release.source,
    asOf: COCKPIT_AS_OF_UNKNOWN,
    value: {
      sha: release.sha,
      verified: false,
      reason: release.reason,
    },
  };
}

export function cockpitRuntimeFact(
  organizationId: string,
  model: RuntimeAuthorityReadModelV2 | null,
): CockpitFact<AdminCockpitRuntimeValue> {
  if (!model || model.organizationId !== organizationId) {
    return {
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.runtimeAuthority,
      asOf: COCKPIT_AS_OF_UNKNOWN,
    };
  }
  return {
    state: "value",
    source: ADMIN_COCKPIT_SOURCES.runtimeAuthority,
    asOf: asOfFromSource(model.adjudicatedAtUtc),
    value: {
      availability: model.availability,
      organizationId: model.organizationId,
      runtimeInstanceId: model.runtimeInstanceId,
      posture: model.posture,
      reasonCodes: [...model.reasonCodes],
      assessmentId: model.assessmentId,
      adjudicatedAtUtc: model.adjudicatedAtUtc,
    },
  };
}

export function freshnessFromObservationBody(
  organizationId: string,
  body: unknown,
): ObservationFreshnessReading | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as {
    binding?: { organizationId?: unknown };
    collectionCompletedAtMs?: unknown;
  };
  if (record.binding?.organizationId !== organizationId) {
    return null;
  }
  if (
    typeof record.collectionCompletedAtMs !== "number" ||
    !Number.isFinite(record.collectionCompletedAtMs)
  ) {
    return null;
  }
  return {
    organizationId,
    collectionCompletedAtMs: record.collectionCompletedAtMs,
  };
}

export function cockpitFreshnessFact(
  organizationId: string,
  reading: ObservationFreshnessReading | null,
): CockpitFact<{ collectionCompletedAtMs: number }> {
  if (
    !reading ||
    reading.organizationId !== organizationId ||
    !Number.isFinite(reading.collectionCompletedAtMs)
  ) {
    return {
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.observationFreshness,
      asOf: COCKPIT_AS_OF_UNKNOWN,
    };
  }
  return {
    state: "value",
    source: ADMIN_COCKPIT_SOURCES.observationFreshness,
    asOf: asOfFromSource(reading.collectionCompletedAtMs),
    value: { collectionCompletedAtMs: reading.collectionCompletedAtMs },
  };
}

function progressOrganizationId(progress: unknown): string | null {
  if (!progress || typeof progress !== "object") {
    return null;
  }
  const record = progress as { organizationId?: unknown; organization_id?: unknown };
  const value = record.organizationId ?? record.organization_id;
  return typeof value === "string" ? value : null;
}

export function cockpitC3Fact(
  organizationId: string,
  campaignRunId: string | null,
  channel: C3ChannelReading | null,
): CockpitFact<unknown> {
  if (!campaignRunId) {
    return {
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.c3MissingRun,
      asOf: COCKPIT_AS_OF_UNKNOWN,
    };
  }
  const embeddedOrganizationId = channel ? progressOrganizationId(channel.progress) : null;
  const sameOrganization =
    channel?.organizationId === organizationId &&
    (embeddedOrganizationId === null || embeddedOrganizationId === organizationId);
  if (channel && sameOrganization && channel.campaignRunId === campaignRunId) {
    return {
      state: "value",
      source: ADMIN_COCKPIT_SOURCES.c3Channel,
      asOf: asOfFromSource(channel.sourceAsOf),
      value: channel.progress,
    };
  }
  return {
    state: "unavailable",
    source: ADMIN_COCKPIT_SOURCES.c3TypedRunOnly,
    asOf: COCKPIT_AS_OF_UNKNOWN,
    operatorCampaignRunId: campaignRunId,
  };
}

function singleParam(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  if (values.length !== 1) {
    return null;
  }
  const value = values[0]?.trim() ?? "";
  return value === "" ? null : value;
}

function observationTarget(url: URL): Record<(typeof OBSERVATION_KEYS)[number], string> | null {
  const target = {} as Record<(typeof OBSERVATION_KEYS)[number], string>;
  for (const key of OBSERVATION_KEYS) {
    const value = singleParam(url, key);
    if (!value) {
      return null;
    }
    target[key] = value;
  }
  return target;
}

async function readRuntimeFromRepository(
  organizationId: string,
  runtime: RuntimeDb,
): Promise<RuntimeAuthorityReadModelV2> {
  const repository =
    runtime.kind === "sqlite"
      ? createSqliteRuntimeAuthorityAssessmentRepositoryV2(runtime.db)
      : createPostgresRuntimeAuthorityAssessmentRepositoryV2(runtime.db);
  return readLatestTenantRuntimeAuthorityV2(repository, { organizationId });
}

export async function readStoredObservationFreshness(
  request: Request,
  organizationId: string,
  deps?: ObservationReadDependencies,
): Promise<ObservationFreshnessReading | null> {
  const owned = deps ? null : createAccountObservationRouteDependencies();
  const observationDeps = deps ?? owned?.deps;
  if (!observationDeps) {
    await owned?.dispose();
    return null;
  }
  try {
    const target = observationTarget(new URL(request.url));
    if (!target) {
      return null;
    }
    const url = new URL("https://waia.local/api/trader/admin/account-observation");
    url.searchParams.set("organizationId", organizationId);
    for (const key of OBSERVATION_KEYS) {
      url.searchParams.set(key, target[key]);
    }
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) {
      headers.set("cookie", cookie);
    }
    const response = await handleAccountObservationGet(
      new Request(url, { method: "GET", headers, signal: request.signal }),
      "admin",
      observationDeps,
    );
    if (!response.ok) {
      return null;
    }
    return freshnessFromObservationBody(organizationId, await response.json());
  } catch {
    return null;
  } finally {
    await owned?.dispose();
  }
}

export async function handleAdminCockpitRead(
  request: Request,
  deps: AdminCockpitReadDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  let runtime: RuntimeDb | undefined;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    let runtimeModel: RuntimeAuthorityReadModelV2 | null = null;
    try {
      runtimeModel = await (deps.readRuntimeAuthority ?? readRuntimeFromRepository)(
        orgParsed,
        runtime,
      );
    } catch {
      runtimeModel = null;
    }

    let freshness: ObservationFreshnessReading | null = null;
    if (observationTarget(url) && deps.readObservationFreshness) {
      try {
        freshness = await deps.readObservationFreshness(request, orgParsed);
      } catch {
        freshness = null;
      }
    }

    const campaignRunId = singleParam(url, "campaign_run_id");
    let channel: C3ChannelReading | null = null;
    if (campaignRunId && deps.readC3Progress) {
      try {
        channel = await deps.readC3Progress({
          organizationId: orgParsed,
          campaignRunId,
        });
      } catch {
        channel = null;
      }
    }

    return adminSuccess(
      {
        organizationId: orgParsed,
        releaseIdentity: cockpitReleaseFact(),
        runtimeAuthority: cockpitRuntimeFact(orgParsed, runtimeModel),
        observationFreshness: cockpitFreshnessFact(orgParsed, freshness),
        c3: cockpitC3Fact(orgParsed, campaignRunId, channel),
      },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
