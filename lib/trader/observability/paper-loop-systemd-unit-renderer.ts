export const PAPER_LOOP_SYSTEMD_UNIT = "waia-paper-loop.service" as const;

export type PaperLoopSystemdUnitConfigV1 = Readonly<{
  schemaVersion: "paper-loop-systemd-unit-config/v1";
  workingDirectory: string;
  serviceUser: string;
  environmentFile: string;
  nodeBin: string;
  organizationId: string;
  accountKey: string;
}>;

const ABSOLUTE_SAFE_PATH = /^\/(?:[a-zA-Z0-9@._-]+\/)*[a-zA-Z0-9@._-]+$/;
const SAFE_IDENTIFIER = /^[a-zA-Z0-9._-]+$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertSafe(config: PaperLoopSystemdUnitConfigV1): void {
  if (config.schemaVersion !== "paper-loop-systemd-unit-config/v1") {
    throw new Error("PAPER_LOOP_UNIT_SCHEMA");
  }
  for (const path of [config.workingDirectory, config.environmentFile, config.nodeBin]) {
    if (!ABSOLUTE_SAFE_PATH.test(path)) throw new Error("PAPER_LOOP_UNIT_PATH");
  }
  if (!SAFE_IDENTIFIER.test(config.serviceUser) || !SAFE_IDENTIFIER.test(config.accountKey)) {
    throw new Error("PAPER_LOOP_UNIT_IDENTIFIER");
  }
  if (!UUID_V4.test(config.organizationId)) throw new Error("PAPER_LOOP_UNIT_ORG");
}

function escapeSystemdValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Renders the operator paper-loop unit. It does not embed a fixture path or a secret. */
export function renderPaperLoopSystemdUnit(config: PaperLoopSystemdUnitConfigV1): string {
  assertSafe(config);
  const wd = escapeSystemdValue(config.workingDirectory);
  const unit = `[Unit]
Description=WAIA paper bar-close loop (mock venue, canonical cycle)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${escapeSystemdValue(config.serviceUser)}
WorkingDirectory=${wd}
EnvironmentFile=${escapeSystemdValue(config.environmentFile)}
Environment=WAIA_TRADER_CLI=1
ExecStart=${escapeSystemdValue(config.nodeBin)} --import tsx --conditions=react-server ${wd}/scripts/trader/paper-bar-close-loop.ts --org-id=${config.organizationId} --account-key=${config.accountKey}
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
  if (/bash\s+-c|sudo|fixture-path|PASSWORD=|API_KEY=|TOKEN=/.test(unit)) {
    throw new Error("PAPER_LOOP_UNIT_FORBIDDEN");
  }
  return unit;
}

export function verifyPaperLoopSystemdUnit(unit: string): void {
  if (!unit.includes(`ExecStart=`) || !unit.includes("scripts/trader/paper-bar-close-loop.ts")) {
    throw new Error("PAPER_LOOP_UNIT_EXEC");
  }
  if (unit.includes("--fixture-path")) throw new Error("PAPER_LOOP_UNIT_FIXTURE");
}
