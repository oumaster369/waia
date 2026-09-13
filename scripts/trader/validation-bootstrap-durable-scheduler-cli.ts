import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertDeclaredHistoricalRunTupleV1,
  assertDurableSurfaceV1,
  assertMandatoryBaselineIdV1,
  refuseNativeBootstrapLedgerAdmissionV1,
} from "../../lib/trader/research/benchmark/validation-bootstrap-durable-v1";
import { runValidationBootstrapDurableSchedulerV1 } from "./validation-bootstrap-durable-scheduler-v1";
import { createValidationBootstrapDurableStoreV1 } from "./validation-bootstrap-durable-store-v1";
import { validationBootstrapExecutionFromEnvironmentV1 } from "../../lib/trader/research/benchmark/validation-bootstrap-v1";

function refuse(reason: string): never {
  throw new Error(`VALIDATION_BOOTSTRAP_DURABLE_CLI_REFUSED:${reason}`);
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) refuse(name);
  return value;
}

function required(argv: readonly string[], name: string): string {
  const value = flag(argv, name);
  if (!value) refuse(name);
  return value;
}

function absoluteFile(path: string, name: string): string {
  if (!isAbsolute(path) || path.includes("\0")) refuse(name);
  return resolve(path);
}

export function parseValidationBootstrapDurableSchedulerCliV1(argv: readonly string[]): Readonly<{
  organizationId: string;
  runId: string;
  releaseSha: string;
  storeRoot: string;
  surface: string;
  baseline: ReturnType<typeof assertMandatoryBaselineIdV1>;
  trialIdentityHex: string;
  differentialsPath: string;
  requestOrganizationId?: string;
  requestRunId?: string;
  requestReleaseSha?: string;
  nativeLedgerPath?: string;
}> {
  return Object.freeze({
    organizationId: required(argv, "--organization-id"),
    runId: required(argv, "--run-id"),
    releaseSha: required(argv, "--release-sha"),
    storeRoot: required(argv, "--store-root"),
    surface: required(argv, "--surface"),
    baseline: assertMandatoryBaselineIdV1(required(argv, "--baseline")),
    trialIdentityHex: required(argv, "--trial-identity-hex"),
    differentialsPath: required(argv, "--differentials-json"),
    requestOrganizationId: flag(argv, "--request-organization-id"),
    requestRunId: flag(argv, "--request-run-id"),
    requestReleaseSha: flag(argv, "--request-release-sha"),
    nativeLedgerPath: flag(argv, "--native-ledger"),
  });
}

export async function runValidationBootstrapDurableSchedulerCliV1(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.WAIA_TRADER_CLI !== "1") refuse("WAIA_TRADER_CLI");
  const parsed = parseValidationBootstrapDurableSchedulerCliV1(argv);
  if (parsed.nativeLedgerPath) {
    const native = readFileSync(absoluteFile(parsed.nativeLedgerPath, "--native-ledger"));
    refuseNativeBootstrapLedgerAdmissionV1(native);
    refuseNativeBootstrapLedgerAdmissionV1(native.toString("utf8"));
    refuse("NATIVE_LEDGER");
  }
  const declaredTuple = assertDeclaredHistoricalRunTupleV1({
    organizationId: parsed.organizationId,
    runId: parsed.runId,
    releaseSha: parsed.releaseSha,
  });
  const store = createValidationBootstrapDurableStoreV1(
    absoluteFile(parsed.storeRoot, "--store-root"),
    declaredTuple,
  );
  if (parsed.requestOrganizationId || parsed.requestRunId || parsed.requestReleaseSha) {
    if (!parsed.requestOrganizationId || !parsed.requestRunId || !parsed.requestReleaseSha) {
      refuse("REQUEST_TUPLE_INCOMPLETE");
    }
    store.bindRequestTuple({
      organizationId: parsed.requestOrganizationId,
      runId: parsed.requestRunId,
      releaseSha: parsed.requestReleaseSha,
    });
  }
  const raw = readFileSync(absoluteFile(parsed.differentialsPath, "--differentials-json"));
  refuseNativeBootstrapLedgerAdmissionV1(raw);
  const parsedJson = JSON.parse(raw.toString("utf8")) as { differentials?: unknown };
  refuseNativeBootstrapLedgerAdmissionV1(parsedJson);
  if (
    !Array.isArray(parsedJson.differentials) ||
    parsedJson.differentials.some((value) => typeof value !== "number")
  ) {
    refuse("DIFFERENTIALS");
  }
  if (!/^[0-9a-f]{64}$/.test(parsed.trialIdentityHex)) refuse("TRIAL");
  const execution = validationBootstrapExecutionFromEnvironmentV1(env);
  const result = await runValidationBootstrapDurableSchedulerV1({
    store,
    declaredTuple,
    surface: assertDurableSurfaceV1(parsed.surface),
    baseline: parsed.baseline,
    differentials: parsedJson.differentials as number[],
    trialIdentityDigest32: Buffer.from(parsed.trialIdentityHex, "hex"),
    workerCount: execution.nodeWorkerCount,
  });
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "validation-bootstrap-durable-scheduler-result/v1",
      admission: "NOT_GRANTED",
      bootstrapVersion: "validation-bootstrap/v2",
      R: 10_000,
      extremeCount: result.extremeCount,
      pRaw: result.pRaw,
      n: result.n,
    })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runValidationBootstrapDurableSchedulerCliV1().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "VALIDATION_BOOTSTRAP_DURABLE_CLI_REFUSED"}\n`,
    );
    process.exitCode = 1;
  });
}
