import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { auditScientificCheckpointsV1, inspectScientificPackageHeadersV1 } from "./scientific-checkpoint-audit-v1";

/** Exit 0 means completed-file integrity only, never scientific PASS or launch authority. */
export function runScientificCheckpointAuditCliV1(args: string[]): number {
  const headersOnly = args.length === 4 && args[3] === "--package-headers";
  if ((!headersOnly && args.length !== 3) || args[0] !== "--root" || !args[1] || args[2] !== "--quiescent-tree") {
    process.stderr.write("CHECKPOINT_AUDIT_USAGE: --root <absolute-private-path> --quiescent-tree [--package-headers]\n");
    return 64;
  }
  try {
    if (headersOnly) {
      const report = inspectScientificPackageHeadersV1(args[1]);
      process.stdout.write(`${JSON.stringify({ format: "waia-scientific-package-headers/v1",
        quiescence: "OPERATOR_ASSERTED_NOT_INDEPENDENTLY_VERIFIED", ...report })}\n`);
      return report.packages.length ? 0 : 2;
    }
    const report = auditScientificCheckpointsV1(args[1]);
    process.stdout.write(`${JSON.stringify({
      format: "waia-scientific-checkpoint-audit-report/v1",
      authorityGranted: false,
      quiescence: "OPERATOR_ASSERTED_NOT_INDEPENDENTLY_VERIFIED",
      ...report,
    })}\n`);
    return report.completedEntries > 0 ? 0 : 2;
  } catch {
    // Never print an exception, path, key, payload or untrusted metadata.
    process.stderr.write("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED\n");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runScientificCheckpointAuditCliV1(process.argv.slice(2));
}
