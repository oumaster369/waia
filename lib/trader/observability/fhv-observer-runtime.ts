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
  systemdShowReader?: FhvSystemdShowReader;
  tickIntervalMs?: number;
  startServer?: boolean;
}>;

function buildCampaignControlExecutor(input: {
  env: FhvObserverRuntimeEnvConfig;
  override?: FhvCampaignControlExecutor;
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
  };
  return createLinuxSystemdCampaignControlExecutor(config);
}

function buildDefaultSystemdShowReader(): FhvSystemdShowReader {
  return async (unit) => {
    const result = await spawnSystemctlBounded(buildSystemctlArgumentArray("show", unit));
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
  const campaignControlExecutor = buildCampaignControlExecutor({
    env,
    override: input.campaignControlExecutor,
  });
  const state = createFhvObserverState({
    runRoot: env.runRoot,
    runId: env.runId,
    organizationId: env.organizationId,
    commandSecret: env.commandSecret,
    observerTunnelSecret: env.observerTunnelSecret,
    bindHost: env.bindHost,
    port: env.port,
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
    (isFhvCommandEnforcementActive(env) ? buildDefaultSystemdShowReader() : undefined);

  async function runTickOnce(): Promise<void> {
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
    if (tickTimer) {
      clearInterval(tickTimer);
    }
    tickTimer = setInterval(() => {
      void runTickOnce().catch(() => {
        writeFileAtomic(
          join(env.runRoot, "fhv-observer-degraded.v1.json"),
          `${JSON.stringify({ degradedAtUtc: new Date().toISOString() }, null, 2)}\n`,
        );
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
      return new Promise<void>((resolve) => {
        if (input.startServer !== false) {
          server.listen(env.port, env.bindHost, () => resolve());
        } else {
          resolve();
        }
        scheduleTicks();
        void runTickOnce();
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
        server.close((error) => {
          if (error && !stopping) {
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
