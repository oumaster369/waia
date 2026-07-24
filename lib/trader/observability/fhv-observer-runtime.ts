import type http from "node:http";

import { assertFhvCampaignRuntimeIdentity } from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import {
  isFhvCommandEnforcementActive,
  resolveFhvObserverRuntimeEnv,
  type FhvObserverRuntimeEnvConfig,
} from "@/lib/trader/observability/fhv-env-config";
import {
  buildSystemctlArgumentArray,
  createLinuxSystemdCampaignControlExecutor,
  createRecordingLinuxSystemdCampaignControlExecutor,
  spawnSystemctlBounded,
  type FhvLinuxSystemdExecutorConfig,
  type FhvSystemctlInvocationResult,
} from "@/lib/trader/observability/fhv-linux-systemd-executor";
import {
  UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR,
  type FhvCampaignControlExecutor,
} from "@/lib/trader/observability/fhv-campaign-control-executor";
import {
  createFhvObserverState,
  runFhvObserverTick,
  type FhvObserverState,
} from "@/lib/trader/observability/fhv-observer-core";
import {
  createFhvObserverHttpServer,
  startFhvObserverServer,
} from "@/lib/trader/observability/fhv-observer-http";
import {
  classifyHostEnforcedCampaignTimeout,
  parseSystemctlShowOutput,
  persistHostEnforcedTimeoutEvidence,
  readCampaignSystemdState,
  type FhvSystemdShowReader,
} from "@/lib/trader/observability/fhv-systemd-supervisor-state";
import { readFhvRehearsalCampaignProgress } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { join } from "node:path";

export type FhvObserverRuntime = Readonly<{
  env: FhvObserverRuntimeEnvConfig;
  state: FhvObserverState;
  server: http.Server;
  tickIntervalMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  runTickOnce(): Promise<void>;
  getBoundPort(): number;
}>;

export type CreateFhvObserverRuntimeInput = Readonly<{
  env?: NodeJS.ProcessEnv;
  campaignControlExecutor?: FhvCampaignControlExecutor;
  spawnSystemctl?: (
    args: readonly string[],
    options?: { timeoutMs?: number; maxOutputBytes?: number },
  ) => Promise<FhvSystemctlInvocationResult>;
  systemdShowReader?: FhvSystemdShowReader;
  tickIntervalMs?: number;
  startServer?: boolean;
}>;

function writeDegradedObserverEvidence(runRoot: string, error: unknown): void {
  writeFileAtomic(
    join(runRoot, "fhv-observer-degraded.v1.json"),
    `${JSON.stringify(
      {
        degradedAtUtc: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    )}\n`,
  );
}

function buildCampaignControlExecutor(input: {
  env: FhvObserverRuntimeEnvConfig;
  override?: FhvCampaignControlExecutor;
  spawnSystemctl?: CreateFhvObserverRuntimeInput["spawnSystemctl"];
}): FhvCampaignControlExecutor {
  if (input.override) {
    return input.override;
  }
  if (!isFhvCommandEnforcementActive(input.env)) {
    return UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR;
  }
  const config: FhvLinuxSystemdExecutorConfig = {
    hostOsQualified: input.env.hostOsQualified,
    deploymentEnabled: input.env.commandEnforcementEnabled,
    runRoot: input.env.runRoot,
    spawnSystemctl: input.spawnSystemctl,
  };
  return createLinuxSystemdCampaignControlExecutor(config);
}

function buildDefaultSystemdShowReader(
  spawnSystemctl: NonNullable<CreateFhvObserverRuntimeInput["spawnSystemctl"]>,
): FhvSystemdShowReader {
  return async (unit) => {
    const result = await spawnSystemctl(buildSystemctlArgumentArray("show", unit));
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }
    return parseSystemctlShowOutput(result.stdout);
  };
}

export function createFhvObserverRuntime(
  input: CreateFhvObserverRuntimeInput = {},
): FhvObserverRuntime {
  const env = resolveFhvObserverRuntimeEnv(input.env);
  assertFhvCampaignRuntimeIdentity({
    runRoot: env.runRoot,
    targetSha: env.targetSha,
    runId: env.runId,
    organizationId: env.organizationId,
  });
  const spawnSystemctl = input.spawnSystemctl ?? spawnSystemctlBounded;
  const campaignControlExecutor = buildCampaignControlExecutor({
    env,
    override: input.campaignControlExecutor,
    spawnSystemctl,
  });
  const state = createFhvObserverState({
    runRoot: env.runRoot,
    runId: env.runId,
    organizationId: env.organizationId,
    commandSecret: env.commandSecret,
    observerTunnelSecret: env.observerTunnelSecret,
    bindHost: env.bindHost,
    port: env.port,
    targetSha: env.targetSha,
    commandEnforcementEnabled: env.commandEnforcementEnabled,
    campaignControlExecutor,
  });
  const server = createFhvObserverHttpServer(
    {
      runRoot: env.runRoot,
      runId: env.runId,
      organizationId: env.organizationId,
      commandSecret: env.commandSecret,
      observerTunnelSecret: env.observerTunnelSecret,
      bindHost: env.bindHost,
      port: env.port,
      targetSha: env.targetSha,
      commandEnforcementEnabled: env.commandEnforcementEnabled,
      campaignControlExecutor,
    },
    { state },
  );
  const tickIntervalMs = input.tickIntervalMs ?? env.tickIntervalMs;
  let tickTimer: NodeJS.Timeout | null = null;
  let tickInFlight: Promise<void> | null = null;
  let stopping = false;
  const systemdShowReader =
    input.systemdShowReader ??
    (isFhvCommandEnforcementActive(env)
      ? buildDefaultSystemdShowReader(spawnSystemctl)
      : undefined);

  async function runTickOnce(): Promise<void> {
    if (stopping) {
      return;
    }
    if (tickInFlight) {
      await tickInFlight;
      return;
    }
    tickInFlight = (async () => {
      const progress = readFhvRehearsalCampaignProgress(env.runRoot);
      if (systemdShowReader) {
        const unitState = await readCampaignSystemdState(systemdShowReader);
        if (unitState && classifyHostEnforcedCampaignTimeout(unitState)) {
          const observedAtUtc = new Date().toISOString();
          persistHostEnforcedTimeoutEvidence({
            runRoot: env.runRoot,
            observedAtUtc,
            unitState,
          });
          writeFileAtomic(
            join(env.runRoot, "fhv-rehearsal-terminal.v1.json"),
            `${JSON.stringify({ classification: "REHEARSAL_TIMEOUT", source: "systemd" }, null, 2)}\n`,
          );
        }
      }
      await runFhvObserverTick(state, {
        cyclesProcessed: progress?.cyclesProcessed,
        phase: progress?.phase,
        terminalState: progress?.phase === "timeout" ? "REHEARSAL_TIMEOUT" : undefined,
      });
    })().finally(() => {
      tickInFlight = null;
    });
    await tickInFlight;
  }

  function scheduleTicks(): void {
    if (stopping || tickTimer) {
      return;
    }
    tickTimer = setInterval(() => {
      if (stopping) {
        return;
      }
      void runTickOnce().catch((error) => {
        writeDegradedObserverEvidence(env.runRoot, error);
      });
    }, tickIntervalMs);
    if (typeof tickTimer.unref === "function") {
      tickTimer.unref();
    }
  }

  return {
    env,
    state,
    server,
    tickIntervalMs,
    getBoundPort() {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("FHV_OBSERVER_PORT_UNAVAILABLE");
      }
      return address.port;
    },
    start() {
      return new Promise<void>((resolve, reject) => {
        const onListening = () => {
          scheduleTicks();
          void runTickOnce().catch((error) => {
            writeDegradedObserverEvidence(env.runRoot, error);
          });
          resolve();
        };
        if (input.startServer === false) {
          onListening();
          return;
        }
        server.once("error", reject);
        server.listen(env.port, env.bindHost, () => {
          server.off("error", reject);
          onListening();
        });
      });
    },
    async stop() {
      stopping = true;
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (tickInFlight) {
        await tickInFlight;
      }
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    runTickOnce,
  };
}

export function startFhvObserverRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FhvObserverRuntime {
  const runtime = createFhvObserverRuntime({ env, startServer: true });
  void runtime.start().catch((error) => {
    process.stderr.write(
      `[fhv-observer-cli] failed to start runtime: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
  return runtime;
}

export {
  createRecordingLinuxSystemdCampaignControlExecutor,
  createLinuxSystemdCampaignControlExecutor,
};
