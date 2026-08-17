/**
 * Fixture-only public-entrypoint rehearsal for pre-launch software proof.
 * No network, no Execution Server, no holdout, no capital.
 */

import { aggregateFhvHostQualificationFromIdentities } from "@/lib/trader/observability/fhv-host-qualification-receipt";
import { runRealHtxPreflight } from "@/lib/trader/market-data/fhv-real-htx-preflight";
import { resolveFhvHostQualifyCliConfig } from "@/scripts/trader/fhv-host-qualify-cli";
import { resolveFhvRealHtxPreflightCliConfig } from "@/scripts/trader/fhv-real-htx-preflight-cli";
import { resolveFhvRevisionRiskCliConfig } from "@/scripts/trader/fhv-revision-risk-cli";
import { resolveFhvPreHoldoutQualifyCliConfig } from "@/scripts/trader/fhv-pre-holdout-qualify-cli";
import { resolveFhvPreHoldoutVerifyCliConfig } from "@/scripts/trader/fhv-pre-holdout-verify-cli";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";

export const PRELAUNCH_FIXTURE_END_TO_END_PASS = "PRELAUNCH_FIXTURE_END_TO_END=PASS" as const;

export async function runPrelaunchPublicEntrypointFixture(): Promise<
  typeof PRELAUNCH_FIXTURE_END_TO_END_PASS
> {
  resolveFhvRevisionRiskCliConfig(process.env, ["--real-htx"]);
  resolveFhvPreHoldoutQualifyCliConfig(process.env, ["--out-dir", "/tmp/out"]);
  resolveFhvPreHoldoutVerifyCliConfig(process.env, ["--receipt", "/tmp/r.json"]);
  resolveFhvHostQualifyCliConfig(process.env, [
    "--release-sha",
    "a".repeat(40),
    "--wp3b-receipt",
    "/tmp/wp3b.json",
    "--throughput-receipt",
    "/tmp/tp.json",
    "--t4-preflight",
    "/tmp/t4.json",
    "--out",
    "/tmp/host.json",
  ]);
  resolveFhvRealHtxPreflightCliConfig(["--fixture"]);

  const host = aggregateFhvHostQualificationFromIdentities({
    releaseSha: "a".repeat(40),
    wp3bReceiptPath: "/tmp/wp3b.json",
    throughputReceiptPath: "/tmp/tp.json",
    t4PreflightPath: "/tmp/t4.json",
    wp3b: {
      classification: "EXECUTION_SERVER_WP3B_HOST_QUALIFIED",
      releaseSha: "a".repeat(40),
      hostname: "waia-dee536-execution-candidate",
    },
    throughput: {
      classification: "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED",
      releaseSha: "a".repeat(40),
      hostname: "waia-dee536-execution-candidate",
    },
    t4: { status: "PASS", hostname: "waia-dee536-execution-candidate" },
  });
  if (host.classification !== "HOST_QUALIFIED") {
    throw new Error(`fixture host qualify failed: ${host.classification}`);
  }
  const cross = aggregateFhvHostQualificationFromIdentities({
    releaseSha: "a".repeat(40),
    wp3bReceiptPath: "/tmp/wp3b.json",
    throughputReceiptPath: "/tmp/tp.json",
    t4PreflightPath: "/tmp/t4.json",
    wp3b: {
      classification: "EXECUTION_SERVER_WP3B_HOST_QUALIFIED",
      releaseSha: "a".repeat(40),
      hostname: "waia-dee536-execution-candidate",
    },
    throughput: {
      classification: "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED",
      releaseSha: "a".repeat(40),
      hostname: "other-host",
    },
    t4: { status: "PASS", hostname: "waia-dee536-execution-candidate" },
  });
  if (cross.classification !== "HOST_QUALIFICATION_BLOCKED_CROSS_TUPLE_HOST") {
    throw new Error(`cross-tuple host evidence was not rejected: ${cross.classification}`);
  }

  const htx = await runRealHtxPreflight({
    fetchPage: async ({ from, size }) =>
      Array.from({ length: Math.min(size, 8) }, (_, index) => {
        const close = 49_000;
        const row: HtxKlineRow = {
          id: from + index * 60,
          open: close,
          close,
          low: close * 0.999,
          high: close * 1.001,
          amount: 3.946,
          vol: close * 3.946,
          count: 10,
        };
        return row;
      }),
  });
  if (htx.classification !== "REAL_HTX_PREFLIGHT=PASS") {
    throw new Error(`fixture REAL_HTX_PREFLIGHT failed: ${htx.classification}`);
  }
  return PRELAUNCH_FIXTURE_END_TO_END_PASS;
}
