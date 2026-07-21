/**
 * Render FHV systemd units to stdout as JSON (used by guarded shell tooling).
 */

import { renderFhvSystemdUnits } from "@/lib/trader/observability/fhv-systemd-unit-renderer";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const units = renderFhvSystemdUnits({
  schemaVersion: "fhv-systemd-unit-config/v1",
  hostOs: "linux",
  qualifiedSupervisor: "SYSTEMD",
  repoRoot: required("FHV_RENDER_REPO_ROOT"),
  workingDirectory: required("FHV_RENDER_WORKING_DIRECTORY"),
  serviceUser: required("FHV_RENDER_SERVICE_USER"),
  environmentFile: required("FHV_RENDER_ENVIRONMENT_FILE"),
  targetSha: required("FHV_RENDER_TARGET_SHA"),
  nodeBin: required("FHV_RENDER_NODE_BIN"),
  fhvRunRoot: required("FHV_RENDER_FHV_RUN_ROOT"),
  fhvRunId: required("FHV_RENDER_FHV_RUN_ID"),
  fhvOrganizationId: required("FHV_RENDER_FHV_ORGANIZATION_ID"),
  observerPort: Number(process.env.FHV_RENDER_OBSERVER_PORT ?? 9471),
});

process.stdout.write(`${JSON.stringify(units)}\n`);
