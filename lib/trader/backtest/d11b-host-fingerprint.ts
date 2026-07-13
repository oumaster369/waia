import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const D11B_HOST_ENVIRONMENT_KEYS = [
  "arch",
  "cpuModel",
  "efficiencyCoreCount",
  "logicalCpuCount",
  "lowPowerMode",
  "nodeOptions",
  "nodeVersion",
  "osVersion",
  "performanceCoreCount",
  "platform",
  "powerSource",
  "totalMemBytes",
] as const;

export type D11bHostEnvironmentKey = (typeof D11B_HOST_ENVIRONMENT_KEYS)[number];

export type D11bHostEnvironment = Record<D11bHostEnvironmentKey, string | number | boolean>;

export class D11bHostFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D11bHostFingerprintError";
  }
}

function sortedCanonicalJson(value: D11bHostEnvironment): string {
  const ordered = Object.fromEntries(
    D11B_HOST_ENVIRONMENT_KEYS.map((key) => [key, value[key]]),
  ) as D11bHostEnvironment;
  return JSON.stringify(ordered);
}

export function computeCanonicalHostFingerprintSha256(value: D11bHostEnvironment): string {
  return createHash("sha256").update(sortedCanonicalJson(value), "utf8").digest("hex");
}

export function parseHostEnvironmentJson(raw: string): D11bHostEnvironment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new D11bHostFingerprintError("[d11b-host] malformed host environment JSON");
  }
  return validateHostEnvironment(parsed);
}

export function validateHostEnvironment(value: unknown): D11bHostEnvironment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new D11bHostFingerprintError("[d11b-host] host environment must be an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  for (const required of D11B_HOST_ENVIRONMENT_KEYS) {
    if (!(required in record)) {
      throw new D11bHostFingerprintError(`[d11b-host] missing required field: ${required}`);
    }
  }
  for (const key of keys) {
    if (!D11B_HOST_ENVIRONMENT_KEYS.includes(key as D11bHostEnvironmentKey)) {
      throw new D11bHostFingerprintError(`[d11b-host] unexpected field: ${key}`);
    }
  }

  const arch = record.arch;
  const cpuModel = record.cpuModel;
  const efficiencyCoreCount = record.efficiencyCoreCount;
  const logicalCpuCount = record.logicalCpuCount;
  const lowPowerMode = record.lowPowerMode;
  const nodeOptions = record.nodeOptions;
  const nodeVersion = record.nodeVersion;
  const osVersion = record.osVersion;
  const performanceCoreCount = record.performanceCoreCount;
  const platform = record.platform;
  const powerSource = record.powerSource;
  const totalMemBytes = record.totalMemBytes;

  if (typeof arch !== "string") throw typeError("arch", "string");
  if (typeof cpuModel !== "string") throw typeError("cpuModel", "string");
  if (typeof efficiencyCoreCount !== "number") throw typeError("efficiencyCoreCount", "number");
  if (typeof logicalCpuCount !== "number") throw typeError("logicalCpuCount", "number");
  if (typeof lowPowerMode !== "boolean") throw typeError("lowPowerMode", "boolean");
  if (typeof nodeOptions !== "string") throw typeError("nodeOptions", "string");
  if (typeof nodeVersion !== "string") throw typeError("nodeVersion", "string");
  if (typeof osVersion !== "string") throw typeError("osVersion", "string");
  if (typeof performanceCoreCount !== "number") throw typeError("performanceCoreCount", "number");
  if (typeof platform !== "string") throw typeError("platform", "string");
  if (typeof powerSource !== "string") throw typeError("powerSource", "string");
  if (typeof totalMemBytes !== "number") throw typeError("totalMemBytes", "number");

  return {
    arch,
    cpuModel,
    efficiencyCoreCount,
    logicalCpuCount,
    lowPowerMode,
    nodeOptions,
    nodeVersion,
    osVersion,
    performanceCoreCount,
    platform,
    powerSource,
    totalMemBytes,
  };
}

function typeError(field: string, expected: string): D11bHostFingerprintError {
  return new D11bHostFingerprintError(`[d11b-host] ${field} must be ${expected}`);
}

function readDarwinOsVersion(): string {
  const swVers = execSync("sw_vers", { encoding: "utf8" });
  const productVersion = /ProductVersion:\s+(.+)/.exec(swVers)?.[1]?.trim() ?? "unknown";
  const buildVersion = /BuildVersion:\s+(.+)/.exec(swVers)?.[1]?.trim() ?? "unknown";
  const darwin = execSync("uname -r", { encoding: "utf8" }).trim();
  return `macOS ${productVersion} (${buildVersion}); Darwin ${darwin}`;
}

function readPowerSource(): string {
  try {
    const output = execSync("pmset -g ps", { encoding: "utf8" });
    if (/AC Power/i.test(output)) {
      return "AC";
    }
    if (/Battery Power/i.test(output)) {
      return "Battery";
    }
  } catch {
    // fall through
  }
  return "AC";
}

function readCoreCounts(): { performanceCoreCount: number; efficiencyCoreCount: number } {
  try {
    const performance = Number(
      execSync("sysctl -n hw.perflevel0.physicalcpu", { encoding: "utf8" }).trim(),
    );
    const efficiency = Number(
      execSync("sysctl -n hw.perflevel1.physicalcpu", { encoding: "utf8" }).trim(),
    );
    if (Number.isFinite(performance) && Number.isFinite(efficiency)) {
      return { performanceCoreCount: performance, efficiencyCoreCount: efficiency };
    }
  } catch {
    // fall through
  }
  const logical = os.cpus().length;
  return {
    performanceCoreCount: Math.max(1, Math.floor(logical / 2)),
    efficiencyCoreCount: Math.max(1, logical - Math.floor(logical / 2)),
  };
}

export function collectLiveHostEnvironment(): D11bHostEnvironment {
  const cores = readCoreCounts();
  return {
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    efficiencyCoreCount: cores.efficiencyCoreCount,
    logicalCpuCount: os.cpus().length,
    lowPowerMode: false,
    nodeOptions: process.env.NODE_OPTIONS ?? "",
    nodeVersion: process.version,
    osVersion:
      process.platform === "darwin" ? readDarwinOsVersion() : `${process.platform} ${os.release()}`,
    performanceCoreCount: cores.performanceCoreCount,
    platform: process.platform,
    powerSource: readPowerSource(),
    totalMemBytes: os.totalmem(),
  };
}

export function loadReferenceHostEnvironment(
  referencePath = path.join(
    process.cwd(),
    ".cursor/plans/dee-415-d11b/reference-host-environment.json",
  ),
): D11bHostEnvironment {
  return parseHostEnvironmentJson(readFileSync(referencePath, "utf8"));
}

export function hostEnvironmentsMatch(
  expected: D11bHostEnvironment,
  actual: D11bHostEnvironment,
): void {
  for (const key of D11B_HOST_ENVIRONMENT_KEYS) {
    if (expected[key] !== actual[key]) {
      throw new D11bHostFingerprintError(
        `[d11b-host] live host mismatch on ${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`,
      );
    }
  }
}

export function verifyCanonicalHostFingerprint(expectedSha256: string): {
  reference: D11bHostEnvironment;
  live: D11bHostEnvironment;
  canonicalSha256: string;
} {
  const reference = loadReferenceHostEnvironment();
  const live = collectLiveHostEnvironment();
  hostEnvironmentsMatch(reference, live);
  const canonicalSha256 = computeCanonicalHostFingerprintSha256(reference);
  if (canonicalSha256 !== expectedSha256) {
    throw new D11bHostFingerprintError(
      `[d11b-host] canonical fingerprint mismatch: expected ${expectedSha256}, got ${canonicalSha256}`,
    );
  }
  return { reference, live, canonicalSha256 };
}
