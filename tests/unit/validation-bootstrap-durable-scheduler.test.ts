// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  aggregateValidationBootstrapCoverageV1,
  aggregateValidationBootstrapMandatoryFamilyV1,
  assertDeclaredHistoricalRunTupleMatchV1,
  createValidationBootstrapDurableMemoryStoreV1,
  digestValidationBootstrapInputV1,
  partitionValidationBootstrapDurableRangesV1,
  refuseNativeBootstrapLedgerAdmissionV1,
  sealValidationBootstrapRangeRecordV1,
  VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION,
  withValidationBootstrapDurableStoreV1,
} from "@/lib/trader/research/benchmark/validation-bootstrap-durable-v1";
import {
  deriveValidationBootstrapRoot,
  INTERNAL_validationBootstrapOrdinalRangeV1,
  VALIDATION_BOOTSTRAP_B,
  VALIDATION_BOOTSTRAP_RANGE_SIZE,
  VALIDATION_BOOTSTRAP_VERSION,
  validationBootstrapPValueAsyncV1,
  validationBootstrapPValueV1,
} from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { MANDATORY_BASELINE_IDS } from "@/lib/trader/research/benchmark/baseline-models-v1";
import { independentValidationPValue } from "./helpers/validation-bootstrap-independent-reference";
import { runValidationBootstrapDurableSchedulerV1 } from "../../scripts/trader/validation-bootstrap-durable-scheduler-v1";
import { createValidationBootstrapDurableStoreV1 } from "../../scripts/trader/validation-bootstrap-durable-store-v1";
import {
  parseValidationBootstrapDurableSchedulerCliV1,
  runValidationBootstrapDurableSchedulerCliV1,
} from "../../scripts/trader/validation-bootstrap-durable-scheduler-cli";

const TUPLE = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  runId: "observed-walk-forward-35",
  releaseSha: "a".repeat(40),
});
const fixture = () => ({
  differentials: Array.from({ length: 31 }, (_, i) => Math.sin(i * 0.731)),
  trialIdentityDigest32: Buffer.alloc(32, 0x55),
});

function kernelRange(start = 0, endExclusive = VALIDATION_BOOTSTRAP_RANGE_SIZE) {
  const input = fixture();
  const result = INTERNAL_validationBootstrapOrdinalRangeV1(input, start, endExclusive);
  return sealValidationBootstrapRangeRecordV1({
    declaredTuple: TUPLE,
    surface: "BTCUSDT:30",
    baseline: "climatology/v1",
    trialIdentityDigest32: input.trialIdentityDigest32,
    differentials: input.differentials,
    ...result,
  });
}

function expectation(input = fixture()) {
  return {
    declaredTuple: TUPLE,
    surface: "BTCUSDT:30",
    baseline: "climatology/v1" as const,
    trialIdentityDigestHex: input.trialIdentityDigest32.toString("hex"),
    inputDigestHex: digestValidationBootstrapInputV1(input.differentials),
    rootSeedHex: deriveValidationBootstrapRoot(input.trialIdentityDigest32).toString("hex"),
  };
}

describe("DEE-1005 durable validation-bootstrap coverage", () => {
  it("tiles B=10000 with the existing 8-ordinal unit and no remainder", () => {
    const ranges = partitionValidationBootstrapDurableRangesV1();
    expect(VALIDATION_BOOTSTRAP_RANGE_SIZE).toBe(8);
    expect(VALIDATION_BOOTSTRAP_B % VALIDATION_BOOTSTRAP_RANGE_SIZE).toBe(0);
    expect(ranges).toHaveLength(VALIDATION_BOOTSTRAP_B / VALIDATION_BOOTSTRAP_RANGE_SIZE);
    expect(ranges[0]).toEqual({ start: 0, endExclusive: 8 });
    expect(ranges.at(-1)).toEqual({ start: 9992, endExclusive: 10000 });
  });

  it("matches the current kernel on a known-answer range and omits pRaw", () => {
    const input = fixture();
    const kernel = INTERNAL_validationBootstrapOrdinalRangeV1(input, 0, 8);
    const record = kernelRange();
    expect(record.bootstrapVersion).toBe(VALIDATION_BOOTSTRAP_VERSION);
    expect(record.R).toBe(10_000);
    expect(record.extremeCount).toBe(kernel.extremeCount);
    expect(record).not.toHaveProperty("pRaw");
    expect(JSON.stringify(record)).not.toMatch(/worker/i);
    expect(record.schedulerIdentity.version).toBe(VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION);
  });

  it("refuses overlap, duplicate and gap without emitting pRaw", () => {
    const first = kernelRange(0, 8);
    const second = kernelRange(8, 16);
    expect(() => aggregateValidationBootstrapCoverageV1([first, first], expectation())).toThrow(
      /DUPLICATE|OVERLAP/,
    );
    expect(() =>
      aggregateValidationBootstrapCoverageV1(
        [first, { ...second, start: 0, endExclusive: 8, resultDigestHex: first.resultDigestHex }],
        expectation(),
      ),
    ).toThrow(/DUPLICATE|OVERLAP|RESULT_DIGEST/);
    try {
      aggregateValidationBootstrapCoverageV1([first, second], expectation());
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).toMatch(/GAP|INCOMPLETE/);
      expect(String(error)).not.toMatch(/pRaw/);
    }
  });

  it("refuses wrong input, wrong R and wrong trial", () => {
    const record = kernelRange();
    expect(() =>
      aggregateValidationBootstrapCoverageV1([record], {
        ...expectation(),
        inputDigestHex: "b".repeat(64),
      }),
    ).toThrow(/INPUT|RESULT_DIGEST/);
    expect(() =>
      aggregateValidationBootstrapCoverageV1([record], {
        ...expectation(),
        trialIdentityDigestHex: "c".repeat(64),
      }),
    ).toThrow(/TRIAL/);
    expect(() =>
      aggregateValidationBootstrapCoverageV1([{ ...record, R: 9999 as 10000 }], expectation()),
    ).toThrow(/R/);
  });

  it("refuses Holm before the five-baseline family has exact coverage", () => {
    expect(() =>
      aggregateValidationBootstrapMandatoryFamilyV1({
        declaredTuple: TUPLE,
        surface: "BTCUSDT:30",
        coverageByBaseline: { "climatology/v1": [kernelRange()] } as never,
        expectationByBaseline: { "climatology/v1": expectation() } as never,
      }),
    ).toThrow(/MANDATORY_BASELINE_FAMILY_INCOMPLETE/);
    expect(MANDATORY_BASELINE_IDS).toEqual([
      "climatology/v1",
      "gaussian-pop-std/v2",
      "student-t5-nu5/v1",
      "rolling-w2000/v1",
      "ewma-lambda094/v3",
    ]);
  });

  it("rejects native DEE-998 ledgers as admission input", () => {
    const frame = Buffer.alloc(52);
    frame.write("WAIAVB01");
    expect(() => refuseNativeBootstrapLedgerAdmissionV1(frame)).toThrow(
      "VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED",
    );
    expect(() =>
      refuseNativeBootstrapLedgerAdmissionV1({
        version: "native-bootstrap-range-experiment/v1",
        extremeCount: 1,
        admission: "NOT_ESTABLISHED",
        statisticDigest: "a".repeat(64),
      }),
    ).toThrow("VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED");
    expect(() => aggregateValidationBootstrapCoverageV1([frame as never], expectation())).toThrow(
      "VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED",
    );
  });

  it("refuses a later request that binds a different declared tuple", () => {
    const store = createValidationBootstrapDurableMemoryStoreV1(TUPLE);
    expect(() => store.bindRequestTuple({ ...TUPLE, runId: "other-run" })).toThrow(
      /DECLARED_TUPLE_MISMATCH/,
    );
    expect(() =>
      assertDeclaredHistoricalRunTupleMatchV1(TUPLE, {
        ...TUPLE,
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow(/DECLARED_TUPLE_MISMATCH/);
  });
});

describe("DEE-1005 durable validation-bootstrap scheduler", () => {
  let root: string;
  beforeEach(() => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    root = realpathSync(mkdtempSync(join(tmpdir(), "waia-durable-bootstrap-")));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("is byte-exact with the current implementation and independent oracle", async () => {
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    const independent = independentValidationPValue(
      input.differentials,
      input.trialIdentityDigest32,
    );
    const store = createValidationBootstrapDurableMemoryStoreV1(TUPLE);
    const actual = await runValidationBootstrapDurableSchedulerV1({
      store,
      declaredTuple: TUPLE,
      surface: "BTCUSDT:30",
      baseline: "climatology/v1",
      differentials: input.differentials,
      trialIdentityDigest32: input.trialIdentityDigest32,
    });
    expect(actual).toEqual(expected);
    expect(actual).toEqual(independent);
    expect(
      store.listSealedRanges({
        declaredTuple: TUPLE,
        surface: "BTCUSDT:30",
        baseline: "climatology/v1",
        trialIdentityDigestHex: input.trialIdentityDigest32.toString("hex"),
        inputDigestHex: digestValidationBootstrapInputV1(input.differentials),
        rootSeedHex: deriveValidationBootstrapRoot(input.trialIdentityDigest32).toString("hex"),
      }),
    ).toHaveLength(1250);
  }, 30_000);

  it("skips sealed ranges after abort and retries only incomplete work", async () => {
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    const store = createValidationBootstrapDurableMemoryStoreV1(TUPLE);
    let sealed = 0;
    const wrapped = {
      ...store,
      sealRange(record: Parameters<typeof store.sealRange>[0]) {
        store.sealRange(record);
        sealed += 1;
      },
    };
    const controller = new AbortController();
    const first = wrapped.sealRange.bind(wrapped);
    wrapped.sealRange = (record) => {
      first(record);
      if (sealed === 3) controller.abort();
    };
    await expect(
      runValidationBootstrapDurableSchedulerV1({
        store: wrapped,
        declaredTuple: TUPLE,
        surface: "BTCUSDT:30",
        baseline: "climatology/v1",
        differentials: input.differentials,
        trialIdentityDigest32: input.trialIdentityDigest32,
        signal: controller.signal,
      }),
    ).rejects.toThrow("VALIDATION_BOOTSTRAP_CANCELLED");
    expect(sealed).toBe(3);
    expect(() =>
      aggregateValidationBootstrapCoverageV1(
        store.listSealedRanges({
          declaredTuple: TUPLE,
          surface: "BTCUSDT:30",
          baseline: "climatology/v1",
          trialIdentityDigestHex: input.trialIdentityDigest32.toString("hex"),
          inputDigestHex: digestValidationBootstrapInputV1(input.differentials),
          rootSeedHex: deriveValidationBootstrapRoot(input.trialIdentityDigest32).toString("hex"),
        }),
        expectation(input),
      ),
    ).toThrow(/GAP|INCOMPLETE/);
    sealed = 0;
    const resumed = await runValidationBootstrapDurableSchedulerV1({
      store: wrapped,
      declaredTuple: TUPLE,
      surface: "BTCUSDT:30",
      baseline: "climatology/v1",
      differentials: input.differentials,
      trialIdentityDigest32: input.trialIdentityDigest32,
    });
    expect(sealed).toBe(1247);
    expect(resumed).toEqual(expected);
    expect(resumed).not.toHaveProperty("partial");
  }, 30_000);

  it("survives SIGKILL before atomic publication and retries the incomplete range", () => {
    const input = fixture();
    const program = `
      const fs = require("node:fs");
      const { createValidationBootstrapDurableStoreV1 } = require("./scripts/trader/validation-bootstrap-durable-store-v1.ts");
      const { sealValidationBootstrapRangeRecordV1 } = require("./lib/trader/research/benchmark/validation-bootstrap-durable-v1.ts");
      const { INTERNAL_validationBootstrapOrdinalRangeV1 } = require("./lib/trader/research/benchmark/validation-bootstrap-v1.ts");
      const tuple = ${JSON.stringify(TUPLE)};
      const store = createValidationBootstrapDurableStoreV1(process.env.STORE_ROOT, tuple);
      const input = { differentials: ${JSON.stringify(fixture().differentials)}, trialIdentityDigest32: Buffer.alloc(32, 0x55) };
      const first = INTERNAL_validationBootstrapOrdinalRangeV1(input, 0, 8);
      store.sealRange(sealValidationBootstrapRangeRecordV1({ declaredTuple: tuple, surface: "BTCUSDT:30",
        baseline: "climatology/v1", trialIdentityDigest32: input.trialIdentityDigest32, differentials: input.differentials, ...first }));
      fs.renameSync = () => process.kill(process.pid, "SIGKILL");
      const second = INTERNAL_validationBootstrapOrdinalRangeV1(input, 8, 16);
      store.sealRange(sealValidationBootstrapRangeRecordV1({ declaredTuple: tuple, surface: "BTCUSDT:30",
        baseline: "climatology/v1", trialIdentityDigest32: input.trialIdentityDigest32, differentials: input.differentials, ...second }));
    `;
    const killed = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions=react-server", "-e", program],
      {
        cwd: process.cwd(),
        timeout: 20_000,
        encoding: "utf8",
        env: { ...process.env, WAIA_TRADER_CLI: "1", STORE_ROOT: root },
      },
    );
    expect(killed.signal).toBe("SIGKILL");
    const store = createValidationBootstrapDurableStoreV1(root, TUPLE);
    const input2 = fixture();
    const listed = store.listSealedRanges({
      declaredTuple: TUPLE,
      surface: "BTCUSDT:30",
      baseline: "climatology/v1",
      trialIdentityDigestHex: input2.trialIdentityDigest32.toString("hex"),
      inputDigestHex: digestValidationBootstrapInputV1(input2.differentials),
      rootSeedHex: deriveValidationBootstrapRoot(input2.trialIdentityDigest32).toString("hex"),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.start).toBe(0);
  }, 20_000);

  it("does not emit pRaw through the async kernel until exact coverage exists", async () => {
    const input = fixture();
    const store = createValidationBootstrapDurableMemoryStoreV1(TUPLE);
    const expected = validationBootstrapPValueV1(input);
    const actual = await withValidationBootstrapDurableStoreV1(store, () =>
      validationBootstrapPValueAsyncV1(input, {
        durableSurface: "BTCUSDT:30",
        durableBaseline: "climatology/v1",
      }),
    );
    expect(actual).toEqual(expected);
  }, 30_000);

  it("refuses native ledgers and declared-tuple mismatch on the CLI before any p-value", async () => {
    const nativePath = join(root, "native.bin");
    const frame = Buffer.alloc(52);
    frame.write("WAIAVB01");
    writeFileSync(nativePath, frame, { mode: 0o600 });
    await expect(
      runValidationBootstrapDurableSchedulerCliV1([
        "--organization-id",
        TUPLE.organizationId,
        "--run-id",
        TUPLE.runId,
        "--release-sha",
        TUPLE.releaseSha,
        "--store-root",
        root,
        "--surface",
        "BTCUSDT:30",
        "--baseline",
        "climatology/v1",
        "--trial-identity-hex",
        "a".repeat(64),
        "--differentials-json",
        join(root, "missing.json"),
        "--native-ledger",
        nativePath,
      ]),
    ).rejects.toThrow(/NATIVE_LEDGER/);
    const store = createValidationBootstrapDurableStoreV1(root, TUPLE);
    expect(() => store.bindRequestTuple({ ...TUPLE, releaseSha: "b".repeat(40) })).toThrow(
      /DECLARED_TUPLE_MISMATCH/,
    );
    await expect(
      runValidationBootstrapDurableSchedulerCliV1([
        "--organization-id",
        TUPLE.organizationId,
        "--run-id",
        TUPLE.runId,
        "--release-sha",
        TUPLE.releaseSha,
        "--store-root",
        root,
        "--surface",
        "BTCUSDT:30",
        "--baseline",
        "climatology/v1",
        "--trial-identity-hex",
        "a".repeat(64),
        "--differentials-json",
        join(root, "missing.json"),
        "--request-organization-id",
        TUPLE.organizationId,
        "--request-run-id",
        "other-run",
        "--request-release-sha",
        TUPLE.releaseSha,
      ]),
    ).rejects.toThrow(/DECLARED_TUPLE_MISMATCH/);
    expect(() => parseValidationBootstrapDurableSchedulerCliV1(["--run-id", TUPLE.runId])).toThrow(
      /organization-id/i,
    );
  });
});
