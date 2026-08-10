import { createHash } from "node:crypto";

export const CONTROL_REPLAY_TEST_ONLY_AUTHORITY_VERSION =
  "CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1" as const;

export const CONTROL_REPLAY_AUTHORITY_CLASS = "TEST_ONLY" as const;
export const CONTROL_REPLAY_EXECUTION_MODE = "mock" as const;
export const CONTROL_REPLAY_CAPITAL_ELIGIBLE = false as const;

export type ControlReplayAuthorityIdentity = {
  executionPurpose: "CONTROL_REPLAY";
  executionMode: typeof CONTROL_REPLAY_EXECUTION_MODE;
  authorityClass: typeof CONTROL_REPLAY_AUTHORITY_CLASS;
  capitalEligible: typeof CONTROL_REPLAY_CAPITAL_ELIGIBLE;
};

export const CONTROL_REPLAY_AUTHORITY_IDENTITY: ControlReplayAuthorityIdentity = {
  executionPurpose: "CONTROL_REPLAY",
  executionMode: CONTROL_REPLAY_EXECUTION_MODE,
  authorityClass: CONTROL_REPLAY_AUTHORITY_CLASS,
  capitalEligible: CONTROL_REPLAY_CAPITAL_ELIGIBLE,
};

export type ProductionSurface = "production" | "FULL_HISTORICAL" | "shadow" | "live";

export class TestOnlyAuthorityRejectedError extends Error {
  readonly code = "TEST_ONLY_AUTHORITY_REJECTED" as const;

  constructor(message: string) {
    super(message);
    this.name = "TestOnlyAuthorityRejectedError";
  }
}

/** Fail-closed: TEST_ONLY authority rejected on production/live/shadow/FULL_HISTORICAL surfaces. */
export function assertControlReplayTestOnlyAuthorityV1(input: {
  surface: ProductionSurface | "CONTROL_REPLAY";
  authority: ControlReplayAuthorityIdentity;
}): void {
  const forbiddenSurfaces: ProductionSurface[] = [
    "production",
    "FULL_HISTORICAL",
    "shadow",
    "live",
  ];

  if (
    forbiddenSurfaces.includes(input.surface as ProductionSurface) &&
    input.authority.authorityClass === CONTROL_REPLAY_AUTHORITY_CLASS
  ) {
    throw new TestOnlyAuthorityRejectedError(
      `TEST_ONLY authority forbidden on surface=${input.surface}`,
    );
  }

  if (input.surface === "CONTROL_REPLAY") {
    if (input.authority.executionPurpose !== "CONTROL_REPLAY") {
      throw new TestOnlyAuthorityRejectedError(
        "CONTROL_REPLAY requires executionPurpose=CONTROL_REPLAY",
      );
    }
    if (input.authority.capitalEligible) {
      throw new TestOnlyAuthorityRejectedError("CONTROL_REPLAY capitalEligible must be false");
    }
  }
}

export function computeControlReplayAuthorityClaimDigest(input: {
  controlReplayParityDigest: string;
  configFreezeDigest: string;
  authority: ControlReplayAuthorityIdentity;
}): string {
  const body = [
    CONTROL_REPLAY_TEST_ONLY_AUTHORITY_VERSION,
    input.authority.executionPurpose,
    input.authority.executionMode,
    input.authority.authorityClass,
    String(input.authority.capitalEligible),
    input.controlReplayParityDigest,
    input.configFreezeDigest,
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}
