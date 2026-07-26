import { describe, expect, it } from "vitest";

import {
  auditPreauthBootstrapBody,
  classifyFhvT4aPreauthRemoteCommand,
} from "@/lib/trader/observability/fhv-t4a-preauth-ledger";

describe("PRE_AUTH ledger (DEE-436 E-07)", () => {
  it("rejects malicious committed bootstrap body before execution classification", () => {
    const audit = auditPreauthBootstrapBody(
      "scripts/ops/fhv-t4-host-preflight.sh",
      "#!/bin/bash\nrm -rf /\n",
    );
    expect(audit.classification).toBe("rejected");

    const classified = classifyFhvT4aPreauthRemoteCommand({
      remoteCommand: "bash -s -- --expected-hostname test",
      hasStdinBootstrap: true,
      bootstrapRepositoryPath: "scripts/ops/fhv-t4-host-preflight.sh",
      bootstrapBody: "#!/bin/bash\nrm -rf /\n",
    });
    expect(classified.classification).toBe("rejected");
    expect(classified.classificationReason).toMatch(/forbidden bootstrap mutation/);
  });

  it("does not classify arbitrary bash -s as read-only without audited bootstrap binding", () => {
    const classified = classifyFhvT4aPreauthRemoteCommand({
      remoteCommand: "bash -s -- foo",
      hasStdinBootstrap: true,
      bootstrapRepositoryPath: null,
      bootstrapBody: "echo mutate > /tmp/x",
    });
    expect(classified.classification).toBe("rejected");
    expect(classified.classificationReason).toMatch(/bootstrap missing repository binding/);
  });

  it("ledger entry shape includes exit status and digests fields", () => {
    const classified = classifyFhvT4aPreauthRemoteCommand({
      remoteCommand: "bash -s -- --origin-url https://example.com",
      hasStdinBootstrap: true,
      bootstrapRepositoryPath: "scripts/ops/fhv-validate-origin-url.sh",
      bootstrapBody: "#!/bin/bash\necho ok\n",
    });
    expect(classified.bootstrapRepositoryPath).toBe("scripts/ops/fhv-validate-origin-url.sh");
    expect(classified.bootstrapBlobSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(classified.originalRemoteCommand).toContain("bash -s --");
  });
});
