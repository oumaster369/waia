import { describe, expect, it } from "vitest";

import { FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS } from "@/lib/trader/observability/fhv-t4-evidence-seal";
import { parseFhvT4aTaggedKeyValueLines } from "@/lib/trader/observability/fhv-t4a-operator-executor";

describe("fhv-t4 seal receipt tagged parsing (DEE-436 F-05)", () => {
  it("parseFhvT4aTaggedKeyValueLines keeps last classification when duplicated", () => {
    const stdout = [
      "classification=FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS",
      "rootDigest=abc123",
      "classification=CEREMONY_SHOULD_NOT_WIN",
      "T4A_RESULT=PASS",
    ].join("\n");
    expect(parseFhvT4aTaggedKeyValueLines(stdout).classification).toBe("CEREMONY_SHOULD_NOT_WIN");
  });

  it("verify-seal classification stays isolated when parsed from verify stdout only", () => {
    const verifySealStdout = [
      "[verify-seal] starting",
      `classification=${FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS}`,
      "rootDigest=deadbeef",
    ].join("\n");
    const ceremonyStdout = [
      "[verify-ceremony] starting",
      "classification=FHV_T4A_STEP_32_OK",
      "T4A_RESULT=PASS",
      "CONTINUITY_RESULT=PASS",
    ].join("\n");

    const verifyTagged = parseFhvT4aTaggedKeyValueLines(verifySealStdout);
    const ceremonyTagged = parseFhvT4aTaggedKeyValueLines(ceremonyStdout);
    const combinedTagged = parseFhvT4aTaggedKeyValueLines(`${verifySealStdout}\n${ceremonyStdout}`);

    expect(verifyTagged.classification).toBe(FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS);
    expect(ceremonyTagged.classification).toBe("FHV_T4A_STEP_32_OK");
    expect(combinedTagged.classification).toBe("FHV_T4A_STEP_32_OK");
    expect(combinedTagged.rootDigest).toBe("deadbeef");
  });

  it("strips bracketed prefixes before parsing key/value lines", () => {
    const stdout = "[step-32] classification=FHV_T4A_STEP_32_OK\n[step-32] T4A_RESULT=PASS";
    expect(parseFhvT4aTaggedKeyValueLines(stdout)).toEqual({
      classification: "FHV_T4A_STEP_32_OK",
      T4A_RESULT: "PASS",
    });
  });
});
