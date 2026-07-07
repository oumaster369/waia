import { describe, expect, it } from "vitest";

import {
  auditBindingSpecSections,
  auditCloudflareEnvInventory,
  auditCronEnvBridge,
  auditDevVarsExample,
  auditEnvExample,
  auditNoInventedEnvVars,
  auditPackageScript,
  auditProviderRegistry,
  auditRequiredDocs,
  auditResearchBypassGuard,
  auditRunbookProvisioningSequence,
  auditStatusDocs,
  runProviderReadinessAudit,
} from "../../scripts/trader/validate-provider-readiness";

const REPO_ROOT = process.cwd();

describe("DEE-392 provider readiness audit", () => {
  it("passes full repository audit", () => {
    const report = runProviderReadinessAudit(REPO_ROOT);
    for (const finding of report.findings) {
      expect(finding.pass, `${finding.id}: ${finding.detail}`).toBe(true);
    }
    expect(report.pass).toBe(true);
  });

  it("auditProviderRegistry finds all Repeat-M9 registry IDs", () => {
    expect(auditProviderRegistry(REPO_ROOT).pass).toBe(true);
  });

  it("auditCronEnvBridge requires COINGECKO_API_KEY bridge", () => {
    expect(auditCronEnvBridge(REPO_ROOT).pass).toBe(true);
  });

  it("auditEnvExample documents MI env names", () => {
    expect(auditEnvExample(REPO_ROOT).pass).toBe(true);
  });

  it("auditDevVarsExample documents worker preview vars", () => {
    expect(auditDevVarsExample(REPO_ROOT).pass).toBe(true);
  });

  it("auditNoInventedEnvVars rejects FRED/Infura template names", () => {
    expect(auditNoInventedEnvVars(REPO_ROOT).pass).toBe(true);
  });

  it("auditBindingSpecSections covers readiness documentation", () => {
    expect(auditBindingSpecSections(REPO_ROOT).pass).toBe(true);
  });

  it("auditRequiredDocs finds runbook and checklist", () => {
    expect(auditRequiredDocs(REPO_ROOT).pass).toBe(true);
  });

  it("auditResearchBypassGuard keeps research isolated from provider clients", () => {
    expect(auditResearchBypassGuard(REPO_ROOT).pass).toBe(true);
  });

  it("auditCloudflareEnvInventory documents MI vars", () => {
    expect(auditCloudflareEnvInventory(REPO_ROOT).pass).toBe(true);
  });

  it("auditStatusDocs reflects provider-readiness sequence", () => {
    expect(auditStatusDocs(REPO_ROOT).pass).toBe(true);
  });

  it("auditRunbookProvisioningSequence includes post-merge steps", () => {
    expect(auditRunbookProvisioningSequence(REPO_ROOT).pass).toBe(true);
  });

  it("auditPackageScript exposes validate:provider-readiness", () => {
    expect(auditPackageScript(REPO_ROOT).pass).toBe(true);
  });
});
