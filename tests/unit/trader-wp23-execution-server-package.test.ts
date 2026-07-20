import { describe, expect, it } from "vitest";

import {
  HTR_EXECUTION_SERVER_PACKAGE_MODE,
  HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION,
  assertHtrExecutionServerPackageManifest,
  buildHtrExecutionServerPackageManifest,
  computeHtrExecutionServerPackageDigest,
} from "@/lib/trader/readiness/htr-execution-server-package";

describe("HTR-WP23 Execution Server code-ready package", () => {
  it("builds option-a code-ready manifest", () => {
    const manifest = buildHtrExecutionServerPackageManifest();
    expect(manifest.schemaVersion).toBe(HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION);
    expect(manifest.packageMode).toBe(HTR_EXECUTION_SERVER_PACKAGE_MODE);
    expect(manifest.attestation.actualServerMutation).toBe("PROHIBITED");
    expect(manifest.attestation.holdoutRead).toBe("PROHIBITED");
    assertHtrExecutionServerPackageManifest(manifest);
  });

  it("references readiness runbook and package docs", () => {
    const manifest = buildHtrExecutionServerPackageManifest();
    expect(manifest.operatorRunbookPath).toBe("docs/ops/HISTORICAL-TEST-READINESS-RUNBOOK.md");
    expect(manifest.packageDocPath).toBe("docs/ops/HTR-EXECUTION-SERVER-CODE-READY-PACKAGE.md");
    expect(manifest.commandReferences.some((entry) => entry.id === "htr-readiness-preflight")).toBe(
      true,
    );
  });

  it("computes stable package digest", () => {
    const first = computeHtrExecutionServerPackageDigest();
    const second = computeHtrExecutionServerPackageDigest(buildHtrExecutionServerPackageManifest());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });
});
