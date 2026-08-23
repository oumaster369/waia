import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  PUBLIC_WORK_PLAN_FRESH_TTL_MS,
  PUBLIC_WORK_PLAN_MAX_STALE_MS,
  PublicWorkPlanConfigError,
  resolvePublicWorkPlanConfig,
} from "@/lib/public-work-plan/config";
import {
  fetchLinearPublicProjects,
  type PublicWorkPlanLinearClientDeps,
} from "@/lib/public-work-plan/linear-client";
import {
  derivePublicWorkPlanProjection,
  unavailablePublicWorkPlan,
} from "@/lib/public-work-plan/projection";
import type { PublicWorkPlanProjection } from "@/lib/public-work-plan/types";

type SuccessfulCache = {
  configKey: string;
  syncedAtMs: number;
  projection: PublicWorkPlanProjection;
};

export type PublicWorkPlanReadResult = {
  status: 200 | 503;
  body: PublicWorkPlanProjection;
  outcome: "success" | "stale" | "config_error" | "internal_error";
  errorClass?: string;
};

export type PublicWorkPlanReaderDeps = PublicWorkPlanLinearClientDeps & {
  now?: () => Date;
  freshTtlMs?: number;
  maxStaleMs?: number;
};

export class PublicWorkPlanReader {
  private cache: SuccessfulCache | undefined;
  private inFlight: { configKey: string; promise: Promise<PublicWorkPlanReadResult> } | undefined;

  constructor(private readonly deps: PublicWorkPlanReaderDeps = {}) {}

  async read(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<PublicWorkPlanReadResult> {
    let config;
    try {
      config = resolvePublicWorkPlanConfig(env);
    } catch (error) {
      return {
        status: 503,
        body: unavailablePublicWorkPlan(),
        outcome: "config_error",
        errorClass:
          error instanceof PublicWorkPlanConfigError ? error.name : "PublicWorkPlanConfigError",
      };
    }

    const now = this.deps.now?.() ?? new Date();
    const freshTtlMs = this.deps.freshTtlMs ?? PUBLIC_WORK_PLAN_FRESH_TTL_MS;
    if (
      this.cache?.configKey === config.cacheKey &&
      now.getTime() - this.cache.syncedAtMs <= freshTtlMs
    ) {
      return { status: 200, body: this.cache.projection, outcome: "success" };
    }

    if (this.inFlight?.configKey === config.cacheKey) return this.inFlight.promise;

    const promise = this.refresh(config, now);
    this.inFlight = { configKey: config.cacheKey, promise };
    try {
      return await promise;
    } finally {
      if (this.inFlight?.promise === promise) this.inFlight = undefined;
    }
  }

  private async refresh(
    config: ReturnType<typeof resolvePublicWorkPlanConfig>,
    now: Date,
  ): Promise<PublicWorkPlanReadResult> {
    try {
      const facts = await fetchLinearPublicProjects(config, this.deps);
      const projection = derivePublicWorkPlanProjection(facts, now);
      this.cache = { configKey: config.cacheKey, syncedAtMs: now.getTime(), projection };
      return { status: 200, body: projection, outcome: "success" };
    } catch (error) {
      const maxStaleMs = this.deps.maxStaleMs ?? PUBLIC_WORK_PLAN_MAX_STALE_MS;
      if (
        this.cache?.configKey === config.cacheKey &&
        now.getTime() - this.cache.syncedAtMs <= maxStaleMs
      ) {
        return {
          status: 200,
          body: { ...this.cache.projection, state: "stale" },
          outcome: "stale",
          errorClass: error instanceof Error ? error.name : "LinearPublicReadError",
        };
      }
      return {
        status: 503,
        body: unavailablePublicWorkPlan(),
        outcome: "internal_error",
        errorClass: error instanceof Error ? error.name : "LinearPublicReadError",
      };
    }
  }
}

const publicWorkPlanReader = new PublicWorkPlanReader();

export function readPublicWorkPlan(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PublicWorkPlanReadResult> {
  return publicWorkPlanReader.read(env);
}
