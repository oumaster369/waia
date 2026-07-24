import {
  resolveFhvSystemdDeployedRevisionPath,
  verifyFhvSystemdDeployedRevisionMatchesTarget,
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

function parseRenderedUnitDigests(
  raw: string | undefined,
): FhvSystemdRenderedUnitDigestsV1 | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as FhvSystemdRenderedUnitDigestsV1;
  return {
    [FHV_SYSTEMD_CAMPAIGN_UNIT]: parsed[FHV_SYSTEMD_CAMPAIGN_UNIT] ?? "",
    [FHV_SYSTEMD_OBSERVER_UNIT]: parsed[FHV_SYSTEMD_OBSERVER_UNIT] ?? "",
  };
}

function main(): void {
  const repoRoot = parseArg("--repo-root") ?? process.cwd();
  const targetSha = parseArg("--target-sha") ?? "";
  if (!targetSha) {
    process.stderr.write("error: --target-sha required\n");
    process.exit(2);
  }

  const record = verifyFhvSystemdDeployedRevisionMatchesTarget({
    repoRoot,
    targetSha,
    releaseTag: parseArg("--release-tag"),
    runId: parseArg("--run-id"),
    organizationId: parseArg("--organization-id"),
    serviceUser: parseArg("--service-user"),
    renderedUnitDigests: parseRenderedUnitDigests(parseArg("--rendered-unit-digests")),
  });
  const path = resolveFhvSystemdDeployedRevisionPath(repoRoot);
  process.stdout.write(
    `${JSON.stringify({ path, releaseSha: record.releaseSha, ok: true }, null, 2)}\n`,
  );
}

main();
