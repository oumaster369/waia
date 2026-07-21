import { validateFhvReleaseIdentityMarkdown } from "@/lib/trader/observability/fhv-release-identity-validator";
import { describe, expect, it } from "vitest";

const SYMBOLIC = `
## Sequence
pnpm trader:fhv:rehearsal -- --target-sha "$EXECUTION_SERVER_TARGET_SHA" --run-id "<human-approved-unique-run-id>"
`;

describe("FHV release identity validator (generic)", () => {
  it("accepts symbolic target in active sections", () => {
    expect(validateFhvReleaseIdentityMarkdown(SYMBOLIC).ok).toBe(true);
  });

  it("rejects literal 40-char target SHA in active sections", () => {
    const bad = `${SYMBOLIC}\n--target-sha abcdef0123456789abcdef0123456789abcdef01`;
    expect(
      validateFhvReleaseIdentityMarkdown(bad).violations.some(
        (v) => v.code === "LITERAL_TARGET_SHA",
      ),
    ).toBe(true);
  });

  it("rejects quoted literal, equals syntax, abbreviated, empty, and wrong variable", () => {
    expect(
      validateFhvReleaseIdentityMarkdown('--target-sha="abcdef0123456789abcdef0123456789abcdef01"')
        .ok,
    ).toBe(false);
    expect(
      validateFhvReleaseIdentityMarkdown("--target-sha=abcdef0123456789abcdef0123456789abcdef01")
        .ok,
    ).toBe(false);
    expect(validateFhvReleaseIdentityMarkdown("--target-sha abcdef01").ok).toBe(false);
    expect(validateFhvReleaseIdentityMarkdown('--target-sha "$DEV_HEAD_SHA"').ok).toBe(false);
    expect(
      validateFhvReleaseIdentityMarkdown(
        `${SYMBOLIC}\npnpm trader:fhv:rehearsal -- --target-sha "$EXECUTION_SERVER_TARGET_SHA"\npnpm trader:fhv:rehearsal -- --target-sha `,
      ).violations.some((v) => v.code === "EMPTY_TARGET"),
    ).toBe(true);
    expect(
      validateFhvReleaseIdentityMarkdown("--target-sha=").violations.some(
        (v) => v.code === "EMPTY_TARGET",
      ),
    ).toBe(true);
  });

  it("rejects feature-head and checkout literal targets in active sections", () => {
    const featureHead =
      "git checkout dfb7b87c31450e1c494da84acaf5d5582f4daa4d && pnpm trader:fhv:rehearsal";
    const featureResult = validateFhvReleaseIdentityMarkdown(featureHead);
    expect(featureResult.ok).toBe(false);
    const checkout =
      "Provision fresh clean checkout at 2f6b164b732ac33275dd47a943fc06467d61be5e before rehearsal.";
    expect(
      validateFhvReleaseIdentityMarkdown(checkout).violations.some(
        (v) => v.code === "LITERAL_CHECKOUT_TARGET" || v.code === "LITERAL_SHA_IN_ACTIVE_SECTION",
      ),
    ).toBe(true);
  });

  it("allows literal SHA in historical evidence section and fails bad command after it", () => {
    const doc = `${SYMBOLIC}
## Historical evidence
| prior | abcdef0123456789abcdef0123456789abcdef01 |
## Active operations
Run checkout 2f6b164b732ac33275dd47a943fc06467d61be5e before deploy.
`;
    const result = validateFhvReleaseIdentityMarkdown(doc, { requireSymbolicTarget: false });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.code === "LITERAL_SHA_IN_ACTIVE_SECTION")).toBe(true);
  });

  it("scans active sections after historical blocks", () => {
    const doc = `${SYMBOLIC}
## Historical evidence
| prior | abcdef0123456789abcdef0123456789abcdef01 |
## Operator sequence
Deploy using $EXECUTION_SERVER_TARGET_SHA only.
`;
    expect(validateFhvReleaseIdentityMarkdown(doc).ok).toBe(true);
  });

  it("reports line numbers for violations", () => {
    const doc = `${SYMBOLIC}\nLine3 --target-sha abcdef0123456789abcdef0123456789abcdef01`;
    const violation = validateFhvReleaseIdentityMarkdown(doc).violations.find(
      (v) => v.code === "LITERAL_TARGET_SHA",
    );
    expect(violation?.line).toBe(5);
  });
});
