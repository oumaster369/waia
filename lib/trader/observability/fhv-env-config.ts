/** DEE-431 — strict EnvironmentFile boolean parsing for FHV observer runtime. */

export function parseFhvStrictBooleanEnv(value: string | undefined): boolean {
  return value?.trim() === "true";
}

export type FhvObserverRuntimeEnvConfig = Readonly<{
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string | undefined;
  commandSecret: string;
  observerTunnelSecret: string;
  bindHost: string;
  port: number;
  hostOsQualified: boolean;
  commandEnforcementEnabled: boolean;
  tickIntervalMs: number;
}>;

export function resolveFhvObserverRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): FhvObserverRuntimeEnvConfig {
  const runRoot = env.FHV_RUN_ROOT?.trim() ?? "";
  const runId = env.FHV_RUN_ID?.trim() ?? "";
  const organizationId = env.FHV_ORGANIZATION_ID?.trim() ?? "";
  const commandSecret = env.FHV_OPERATOR_COMMAND_SECRET?.trim() ?? "";
  const observerTunnelSecret = env.FHV_OBSERVER_TUNNEL_SECRET?.trim() ?? "";
  if (!runRoot || !runId || !organizationId || !commandSecret || !observerTunnelSecret) {
    throw new Error(
      "FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_OPERATOR_COMMAND_SECRET, FHV_OBSERVER_TUNNEL_SECRET required",
    );
  }
  const tickIntervalRaw = Number(env.FHV_OBSERVER_TICK_INTERVAL_MS ?? "5000");
  const tickIntervalMs =
    Number.isFinite(tickIntervalRaw) && tickIntervalRaw >= 1000 ? tickIntervalRaw : 5000;
  return {
    runRoot,
    runId,
    organizationId,
    targetSha: env.FHV_TARGET_SHA?.trim(),
    commandSecret,
    observerTunnelSecret,
    bindHost: env.FHV_OBSERVER_BIND_HOST?.trim() || "127.0.0.1",
    port: Number(env.FHV_OBSERVER_PORT ?? 9471),
    hostOsQualified: parseFhvStrictBooleanEnv(env.FHV_HOST_OS_QUALIFIED),
    commandEnforcementEnabled: parseFhvStrictBooleanEnv(env.FHV_COMMAND_ENFORCEMENT_ENABLED),
    tickIntervalMs,
  };
}

export function isFhvCommandEnforcementActive(config: {
  hostOsQualified: boolean;
  commandEnforcementEnabled: boolean;
}): boolean {
  return config.hostOsQualified && config.commandEnforcementEnabled;
}
