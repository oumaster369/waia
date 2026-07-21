import {
  assertFhvSystemdUnitConfig,
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
  type FhvSystemdUnitConfigV1,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

export type FhvRenderedSystemdUnits = Readonly<{
  campaignUnitName: typeof FHV_SYSTEMD_CAMPAIGN_UNIT;
  observerUnitName: typeof FHV_SYSTEMD_OBSERVER_UNIT;
  campaignUnit: string;
  observerUnit: string;
}>;

function escapeSystemdValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderCampaignUnit(config: FhvSystemdUnitConfigV1): string {
  const wd = escapeSystemdValue(config.workingDirectory);
  const envFile = escapeSystemdValue(config.environmentFile);
  const user = escapeSystemdValue(config.serviceUser);
  const nodeBin = escapeSystemdValue(config.nodeBin);
  const repoRoot = escapeSystemdValue(config.repoRoot);
  const targetSha = escapeSystemdValue(config.targetSha);
  const runRoot = escapeSystemdValue(config.fhvRunRoot);
  const runId = escapeSystemdValue(config.fhvRunId);
  const orgId = escapeSystemdValue(config.fhvOrganizationId);

  return `[Unit]
Description=WAIA FHV rehearsal campaign (read-only bounded replay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${wd}
EnvironmentFile=${envFile}
Environment=WAIA_TRADER_CLI=1
Environment=FHV_RUN_ROOT=${runRoot}
Environment=FHV_RUN_ID=${runId}
Environment=FHV_ORGANIZATION_ID=${orgId}
Environment=FHV_TARGET_SHA=${targetSha}
Environment=FHV_REHEARSAL_MODE=true
ExecStartPre=${repoRoot}/scripts/ops/execution-server-preflight.sh --repo-path ${repoRoot} --target-sha ${targetSha}
ExecStart=${nodeBin} --import tsx --conditions=react-server ${wd}/scripts/trader/fhv-campaign-cli.ts
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=3
TimeoutStopSec=120
KillMode=mixed
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${runRoot}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function renderObserverUnit(config: FhvSystemdUnitConfigV1): string {
  const wd = escapeSystemdValue(config.workingDirectory);
  const envFile = escapeSystemdValue(config.environmentFile);
  const user = escapeSystemdValue(config.serviceUser);
  const nodeBin = escapeSystemdValue(config.nodeBin);
  const repoRoot = escapeSystemdValue(config.repoRoot);
  const targetSha = escapeSystemdValue(config.targetSha);
  const runRoot = escapeSystemdValue(config.fhvRunRoot);
  const runId = escapeSystemdValue(config.fhvRunId);
  const orgId = escapeSystemdValue(config.fhvOrganizationId);
  const port = String(config.observerPort);

  return `[Unit]
Description=WAIA FHV observer (localhost-only control plane)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${wd}
EnvironmentFile=${envFile}
Environment=WAIA_TRADER_CLI=1
Environment=FHV_RUN_ROOT=${runRoot}
Environment=FHV_RUN_ID=${runId}
Environment=FHV_ORGANIZATION_ID=${orgId}
Environment=FHV_OBSERVER_PORT=${port}
Environment=FHV_TARGET_SHA=${targetSha}
ExecStartPre=${repoRoot}/scripts/ops/execution-server-preflight.sh --repo-path ${repoRoot} --target-sha ${targetSha}
ExecStart=${nodeBin} --import tsx --conditions=react-server ${wd}/scripts/trader/fhv-observer-cli.ts
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${runRoot}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

export function renderFhvSystemdUnits(config: FhvSystemdUnitConfigV1): FhvRenderedSystemdUnits {
  assertFhvSystemdUnitConfig(config);
  const campaignUnit = renderCampaignUnit(config);
  const observerUnit = renderObserverUnit(config);
  for (const unit of [campaignUnit, observerUnit]) {
    if (/bash\s+-c|sudo|git (fetch|pull|checkout|reset|clean|stash|commit)/.test(unit)) {
      throw new Error("Rendered unit contains forbidden command pattern.");
    }
    if (/\b(AWS_SECRET|PASSWORD=|API_KEY=|TOKEN=)/.test(unit)) {
      throw new Error("Rendered unit must not contain secret literals.");
    }
  }
  return {
    campaignUnitName: FHV_SYSTEMD_CAMPAIGN_UNIT,
    observerUnitName: FHV_SYSTEMD_OBSERVER_UNIT,
    campaignUnit,
    observerUnit,
  };
}
