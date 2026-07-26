import { describe, expect, it } from "vitest";

import { resolveFhvRehearsalCliConfig } from "@/scripts/trader/fhv-rehearsal-cli";
import {
  parseFhvT4ClosureSubcommand,
  resolveFhvT4ClosureCliConfig,
} from "@/scripts/trader/fhv-t4-closure-cli";

const TARGET_SHA = "a".repeat(40);
const RUN_ID = "t4a-live-exec";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

describe("fhv-t4a live executability argv contracts (DEE-436)", () => {
  it("step 6 rehearsal parser binds targetSha from argv", () => {
    const config = resolveFhvRehearsalCliConfig({} as NodeJS.ProcessEnv, [
      "--target-sha",
      TARGET_SHA,
      "--run-id",
      RUN_ID,
      "--organization-id",
      ORG_ID,
      "--artifact-root",
      "/srv/fhv/artifacts",
      "--fixture",
      "HTR_WP03_BENCHMARK",
      "--t4-deterministic-pause",
    ]);
    expect(config.targetSha).toBe(TARGET_SHA);
    expect(config.t4DeterministicPause).toBe(true);
  });

  it("rejects rehearsal argv missing target-sha", () => {
    expect(() =>
      resolveFhvRehearsalCliConfig({} as NodeJS.ProcessEnv, [
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--artifact-root",
        "/srv/fhv/artifacts",
      ]),
    ).toThrow(/target-sha must be a full git SHA/);
  });

  it("parses verify-ceremony strict argv", () => {
    const argv = [
      "verify-ceremony",
      "--run-root",
      "/srv/fhv/artifacts/RI-P7/fhv-ops-rehearsal/run",
      "--run-id",
      RUN_ID,
      "--organization-id",
      ORG_ID,
      "--target-sha",
      TARGET_SHA,
      "--release-tag",
      "v1.0.0",
      "--repo-root",
      `/srv/fhv/checkouts/waia-${TARGET_SHA}`,
      "--seal-destination",
      "/srv/fhv/artifacts/RI-P7/fhv-ops-rehearsal-seals/run",
      "--continuity-before",
      "/srv/fhv/artifacts/RI-P7/fhv-ops-rehearsal/run/control/before.json",
      "--continuity-after",
      "/srv/fhv/artifacts/RI-P7/fhv-ops-rehearsal/run/control/after.json",
      "--service-user",
      "fhv",
      "--working-directory",
      `/srv/fhv/checkouts/waia-${TARGET_SHA}`,
      "--environment-file",
      "/etc/fhv/fhv.env",
      "--operator-id",
      "operator-1",
      "--rendered-units-dir",
      `/srv/fhv/checkouts/waia-${TARGET_SHA}/.ops/rendered-units`,
      "--installed-units-dir",
      "/etc/systemd/system",
    ];
    expect(parseFhvT4ClosureSubcommand(argv)).toBe("verify-ceremony");
    const config = resolveFhvT4ClosureCliConfig(process.env, argv);
    expect(config.subcommand).toBe("verify-ceremony");
    expect(config.targetSha).toBe(TARGET_SHA);
  });

  it("rejects verify-rollback unsupported flags", () => {
    expect(() =>
      resolveFhvT4ClosureCliConfig(process.env, [
        "verify-rollback",
        "--run-root",
        "/srv/run",
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--target-sha",
        TARGET_SHA,
        "--repo-root",
        "/srv/repo",
        "--rendered-units-dir",
        "/srv/rendered",
      ]),
    ).toThrow(/Unsupported flag for verify-rollback/);
  });
});
