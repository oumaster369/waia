import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  D11B_HOST_ENVIRONMENT_KEYS,
  collectLiveHostEnvironment,
  computeCanonicalHostFingerprintSha256,
  hostEnvironmentsMatch,
  loadReferenceHostEnvironment,
  parseHostEnvironmentJson,
  validateHostEnvironment,
  verifyCanonicalHostFingerprint,
} from "@/lib/trader/backtest/d11b-host-fingerprint";
import { D11B_APPROVED_HOST_FINGERPRINT_SHA256 } from "@/lib/trader/backtest/replay-qualification-harness";

const APPROVED_OBJECT = {
  arch: "arm64",
  cpuModel: "Apple M5",
  efficiencyCoreCount: 6,
  logicalCpuCount: 10,
  lowPowerMode: false,
  nodeOptions: "",
  nodeVersion: "v22.22.3",
  osVersion: "macOS 26.5 (25F71); Darwin 25.5.0",
  performanceCoreCount: 4,
  platform: "darwin",
  powerSource: "AC",
  totalMemBytes: 17179869184,
};

const APPROVED_CANONICAL =
  '{"arch":"arm64","cpuModel":"Apple M5","efficiencyCoreCount":6,"logicalCpuCount":10,"lowPowerMode":false,"nodeOptions":"","nodeVersion":"v22.22.3","osVersion":"macOS 26.5 (25F71); Darwin 25.5.0","performanceCoreCount":4,"platform":"darwin","powerSource":"AC","totalMemBytes":17179869184}';

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isD11bQualificationHost(): boolean {
  try {
    hostEnvironmentsMatch(loadReferenceHostEnvironment(), collectLiveHostEnvironment());
    return true;
  } catch {
    return false;
  }
}

describe("D-11B canonical host fingerprint", () => {
  it("hashes approved semantic object to the canonical fingerprint", () => {
    expect(computeCanonicalHostFingerprintSha256(APPROVED_OBJECT)).toBe(
      D11B_APPROVED_HOST_FINGERPRINT_SHA256,
    );
    expect(sha(APPROVED_CANONICAL)).toBe(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
  });

  it("is invariant to JSON formatting and key order", () => {
    const compact = `${APPROVED_CANONICAL}\n`;
    const crlf = `${APPROVED_CANONICAL}\r\n`;
    const pretty = `${JSON.stringify(APPROVED_OBJECT, null, 2)}\n`;
    const reordered = JSON.stringify({
      totalMemBytes: 17179869184,
      platform: "darwin",
      powerSource: "AC",
      performanceCoreCount: 4,
      osVersion: "macOS 26.5 (25F71); Darwin 25.5.0",
      nodeVersion: "v22.22.3",
      nodeOptions: "",
      lowPowerMode: false,
      logicalCpuCount: 10,
      efficiencyCoreCount: 6,
      cpuModel: "Apple M5",
      arch: "arm64",
    });

    expect(parseHostEnvironmentJson(compact)).toEqual(APPROVED_OBJECT);
    expect(parseHostEnvironmentJson(crlf)).toEqual(APPROVED_OBJECT);
    expect(parseHostEnvironmentJson(pretty)).toEqual(APPROVED_OBJECT);
    expect(computeCanonicalHostFingerprintSha256(parseHostEnvironmentJson(compact))).toBe(
      D11B_APPROVED_HOST_FINGERPRINT_SHA256,
    );
    expect(computeCanonicalHostFingerprintSha256(parseHostEnvironmentJson(crlf))).toBe(
      D11B_APPROVED_HOST_FINGERPRINT_SHA256,
    );
    expect(computeCanonicalHostFingerprintSha256(parseHostEnvironmentJson(pretty))).toBe(
      D11B_APPROVED_HOST_FINGERPRINT_SHA256,
    );
    expect(computeCanonicalHostFingerprintSha256(parseHostEnvironmentJson(reordered))).toBe(
      D11B_APPROVED_HOST_FINGERPRINT_SHA256,
    );
    expect(sha(compact)).not.toBe(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
    expect(sha(compact)).toBe("a9a63ba0bc1b519331ddc87e29fd9aacca6c6f86fa72d2dead3322e2a8da86a0");
  });

  it("rejects missing, extra, wrong-type, changed-value and malformed payloads", () => {
    expect(() => parseHostEnvironmentJson("{")).toThrow(/malformed/);
    const missing = { ...APPROVED_OBJECT };
    delete (missing as Partial<typeof missing>).arch;
    expect(() => validateHostEnvironment(missing)).toThrow(/missing required field: arch/);
    expect(() => validateHostEnvironment({ ...APPROVED_OBJECT, extra: true })).toThrow(
      /unexpected field: extra/,
    );
    expect(() => validateHostEnvironment({ ...APPROVED_OBJECT, arch: 1 })).toThrow(
      /arch must be string/,
    );
    expect(() => validateHostEnvironment({ ...APPROVED_OBJECT, cpuModel: "Other" })).not.toThrow();
    expect(() =>
      hostEnvironmentsMatch(APPROVED_OBJECT, { ...APPROVED_OBJECT, cpuModel: "Other" }),
    ).toThrow(/live host mismatch/);
    expect(() => verifyCanonicalHostFingerprint("0".repeat(64))).toThrow();
  });

  it.skipIf(!isD11bQualificationHost())(
    "verifies live host against reference file on qualification host",
    () => {
      const result = verifyCanonicalHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
      expect(result.canonicalSha256).toBe(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
      expect(
        D11B_HOST_ENVIRONMENT_KEYS.every((key) => result.reference[key] === result.live[key]),
      ).toBe(true);
    },
  );
});
