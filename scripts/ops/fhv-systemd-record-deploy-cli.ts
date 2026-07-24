import {
  previewFhvSystemdDeployedRevision,
  resolveFhvSystemdDeployedRevisionPath,
  writeFhvSystemdDeployedRevisionAtomic,
  type FhvSystemdDeployedRevisionInput,
  type FhvSystemdRenderedUnitDigestsV1,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1]?.trim();
}

function parseRenderedUnitDigests(raw: string): FhvSystemdRenderedUnitDigestsV1 {
  const parsed = JSON.parse(raw) as FhvSystemdRenderedUnitDigestsV1;
  return {
    [FHV_SYSTEMD_CAMPAIGN_UNIT]: parsed[FHV_SYSTEMD_CAMPAIGN_UNIT] ?? "",
    [FHV_SYSTEMD_OBSERVER_UNIT]: parsed[FHV_SYSTEMD_OBSERVER_UNIT] ?? "",
  };
}

function main(): void {
  const repoRoot = parseArg("--repo-root") ?? process.cwd();
  const releaseSha = parseArg("--target-sha") ?? parseArg("--release-sha") ?? "";
  const releaseTag = parseArg("--release-tag") ?? "";
  const runId = parseArg("--run-id") ?? "";
  const organizationId = parseArg("--organization-id") ?? "";
  const operatorId = parseArg("--operator") ?? parseArg("--operator-id") ?? "";
  const serviceUser = parseArg("--service-user") ?? "";
  const installedAtUtc = parseArg("--installed-at") ?? new Date().toISOString();
  const renderedRaw = parseArg("--rendered-unit-digests") ?? "";
  const legacyContainerRunningRaw = parseArg("--legacy-container-running") ?? "true";
  const confirm = process.argv.includes("--confirm");

  if (!releaseSha || !releaseTag || !runId || !organizationId || !operatorId || !serviceUser) {
    process.stderr.write(
      "error: --target-sha, --release-tag, --run-id, --organization-id, --operator, --service-user required\n",
    );
    process.exit(2);
  }
  if (!renderedRaw) {
    process.stderr.write("error: --rendered-unit-digests JSON required\n");
    process.exit(2);
  }

  const input: FhvSystemdDeployedRevisionInput = {
    releaseSha,
    releaseTag,
    runId,
    organizationId,
    renderedUnitDigests: parseRenderedUnitDigests(renderedRaw),
    installedAtUtc,
    operatorId,
    serviceUser,
    legacyContainerRunning: legacyContainerRunningRaw === "true",
  };

  if (!confirm) {
    const preview = previewFhvSystemdDeployedRevision(input);
    const path = resolveFhvSystemdDeployedRevisionPath(repoRoot);
    process.stdout.write(`${JSON.stringify({ path, preview }, null, 2)}\n`);
    return;
  }

  const record = writeFhvSystemdDeployedRevisionAtomic(repoRoot, input);
  const path = resolveFhvSystemdDeployedRevisionPath(repoRoot);
  process.stdout.write(`${JSON.stringify({ path, record }, null, 2)}\n`);
}

main();
