import { describe, expect, it } from "vitest";

import {
  isFhvCommandEnforcementActive,
  parseFhvStrictBooleanEnv,
  resolveFhvObserverRuntimeEnv,
} from "@/lib/trader/observability/fhv-env-config";

describe("fhv-env-config", () => {
  it("parses strict booleans as exact true only", () => {
    expect(parseFhvStrictBooleanEnv(undefined)).toBe(false);
    expect(parseFhvStrictBooleanEnv("")).toBe(false);
    expect(parseFhvStrictBooleanEnv("TRUE")).toBe(false);
    expect(parseFhvStrictBooleanEnv("1")).toBe(false);
    expect(parseFhvStrictBooleanEnv("true")).toBe(true);
  });

  it("requires observer runtime env fields", () => {
    expect(() => resolveFhvObserverRuntimeEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toThrow(
      /required/,
    );
  });

  it("activates command enforcement only when both gates are true", () => {
    expect(
      isFhvCommandEnforcementActive({
        hostOsQualified: true,
        commandEnforcementEnabled: false,
      }),
    ).toBe(false);
    expect(
      isFhvCommandEnforcementActive({
        hostOsQualified: true,
        commandEnforcementEnabled: true,
      }),
    ).toBe(true);
  });
});
