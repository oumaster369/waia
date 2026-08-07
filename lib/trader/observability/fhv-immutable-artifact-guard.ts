import { readFileSync } from "node:fs";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export class FhvImmutableArtifactCollisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvImmutableArtifactCollisionError";
  }
}

/** Fail closed when an existing immutable artifact does not exactly match requested fields. */
export function assertImmutableArtifactExactMatch<T extends Record<string, unknown>>(input: {
  artifactPath: string;
  artifactLabel: string;
  existing: T;
  requested: T;
  compareKeys: readonly (keyof T)[];
}): void {
  for (const key of input.compareKeys) {
    const existingValue = input.existing[key];
    const requestedValue = input.requested[key];
    const existingDigest =
      existingValue && typeof existingValue === "object"
        ? computePayloadDigest(existingValue as Record<string, unknown>)
        : existingValue;
    const requestedDigest =
      requestedValue && typeof requestedValue === "object"
        ? computePayloadDigest(requestedValue as Record<string, unknown>)
        : requestedValue;
    if (existingDigest !== requestedDigest) {
      throw new FhvImmutableArtifactCollisionError(
        "IMMUTABLE_ARTIFACT_FIELD_COLLISION",
        `${input.artifactLabel} at ${input.artifactPath} already exists with mismatched ${String(key)}.`,
      );
    }
  }
}

export function readJsonArtifact<T>(artifactPath: string): T {
  return JSON.parse(readFileSync(artifactPath, "utf8")) as T;
}
