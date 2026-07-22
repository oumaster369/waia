import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { join } from "node:path";

import { FHV_SYSTEMD_CAMPAIGN_UNIT } from "@/lib/trader/observability/fhv-systemd-unit-config";

export type FhvSystemdUnitShowState = Readonly<{
  activeState: string | null;
  subState: string | null;
  result: string | null;
  execMainCode: number | null;
  execMainStatus: number | null;
  inactiveExitStatus: number | null;
}>;

export type FhvSystemdShowReader = (unit: string) => Promise<FhvSystemdUnitShowState | null>;

export function parseSystemctlShowOutput(output: string): FhvSystemdUnitShowState {
  const fields = new Map<string, string>();
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    fields.set(line.slice(0, idx), line.slice(idx + 1));
  }
  const parseNum = (value: string | undefined): number | null => {
    if (!value || value === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    activeState: fields.get("ActiveState") ?? null,
    subState: fields.get("SubState") ?? null,
    result: fields.get("Result") ?? null,
    execMainCode: parseNum(fields.get("ExecMainCode")),
    execMainStatus: parseNum(fields.get("ExecMainStatus")),
    inactiveExitStatus: parseNum(fields.get("InactiveExitStatus")),
  };
}

export function classifyHostEnforcedCampaignTimeout(state: FhvSystemdUnitShowState): boolean {
  return state.result === "timeout";
}

export async function readCampaignSystemdState(
  reader: FhvSystemdShowReader,
): Promise<FhvSystemdUnitShowState | null> {
  return reader(FHV_SYSTEMD_CAMPAIGN_UNIT);
}

export function persistHostEnforcedTimeoutEvidence(input: {
  runRoot: string;
  observedAtUtc: string;
  unitState: FhvSystemdUnitShowState;
}): void {
  writeFileAtomic(
    join(input.runRoot, "fhv-host-timeout.v1.json"),
    `${JSON.stringify(
      {
        classification: "REHEARSAL_TIMEOUT",
        source: "systemd",
        observedAtUtc: input.observedAtUtc,
        unitState: input.unitState,
      },
      null,
      2,
    )}\n`,
  );
}
