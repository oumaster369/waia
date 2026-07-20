import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export const FHV_RUN_LOG_SECURITY_CONTRACT_ID = "SEC-SYMLINK-001" as const;

export const FHV_LOG_SUBDIRS = {
  semanticEvents: "logs/semantic-events",
  reports: "reports",
  manifests: "manifests",
} as const;

export const FHV_REPORT_FILE_NAMES = {
  operatorReport: "operator-report.json",
  pnlReport: "fhv-pnl-report.json",
  moduleHealthReport: "fhv-module-health-report.json",
  decisionTraceReport: "fhv-decision-trace-report.json",
  executionPositionReport: "fhv-execution-and-position-report.json",
  reconciliationReport: "fhv-reconciliation-report.json",
  knowledgeCalibrationReport: "fhv-knowledge-and-calibration-report.json",
} as const;

export const FHV_SEMANTIC_EVENTS_FILE_NAME = "events.jsonl" as const;
export const FHV_RUN_MANIFEST_FILE_NAME = "run-manifest.json" as const;

export type ResolveFhvRunLogRootInput = Readonly<{
  root: string;
  organizationId: string;
  accountKey: string;
  runId: string;
  cwd?: string;
}>;

function assertResolvedPathUnderRoot(resolvedPath: string, resolvedRoot: string): void {
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSep)) {
    throw new Error(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:PATH_TRAVERSAL`);
  }
}

function assertNoSymlinkLeaf(resolvedPath: string, label: string): void {
  if (!existsSync(resolvedPath)) {
    return;
  }
  const leafStat = lstatSync(resolvedPath);
  if (leafStat.isSymbolicLink()) {
    throw new Error(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:${label}_LEAF_IS_SYMLINK`);
  }
}

export function resolveFhvRunLogRoot(input: ResolveFhvRunLogRootInput): string {
  const cwd = input.cwd ?? process.cwd();
  const resolvedRoot = path.resolve(
    path.isAbsolute(input.root) ? input.root : path.join(cwd, input.root),
  );
  assertNoSymlinkLeaf(resolvedRoot, "RUN_LOG_ROOT");
  const resolvedRunRoot = path.resolve(
    resolvedRoot,
    input.organizationId,
    input.accountKey,
    input.runId,
  );

  assertResolvedPathUnderRoot(resolvedRunRoot, resolvedRoot);
  if (
    path.basename(resolvedRunRoot) !== input.runId ||
    path.basename(path.dirname(resolvedRunRoot)) !== input.accountKey ||
    path.basename(path.dirname(path.dirname(resolvedRunRoot))) !== input.organizationId
  ) {
    throw new Error(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:RUN_SCOPE_MISMATCH`);
  }

  assertNoSymlinkLeaf(resolvedRunRoot, "RUN_ROOT");
  const canonicalRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
  if (existsSync(resolvedRunRoot)) {
    const realRunRoot = realpathSync(resolvedRunRoot);
    assertResolvedPathUnderRoot(realRunRoot, canonicalRoot);
  }

  return resolvedRunRoot;
}

export function resolveFhvSemanticEventsPath(runRoot: string): string {
  return path.join(runRoot, FHV_LOG_SUBDIRS.semanticEvents, FHV_SEMANTIC_EVENTS_FILE_NAME);
}

export function resolveFhvReportsDir(runRoot: string): string {
  return path.join(runRoot, FHV_LOG_SUBDIRS.reports);
}

export function resolveFhvRunManifestPath(runRoot: string): string {
  return path.join(runRoot, FHV_LOG_SUBDIRS.manifests, FHV_RUN_MANIFEST_FILE_NAME);
}

export function assertFhvRunLogTargetAllowed(runRoot: string, allowedRoot: string): void {
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedAllowedRoot = path.resolve(allowedRoot);
  assertResolvedPathUnderRoot(resolvedRunRoot, resolvedAllowedRoot);
  assertNoSymlinkLeaf(resolvedRunRoot, "RUN_ROOT");
  const canonicalAllowedRoot = existsSync(resolvedAllowedRoot)
    ? realpathSync(resolvedAllowedRoot)
    : resolvedAllowedRoot;
  if (existsSync(resolvedRunRoot)) {
    const realRunRoot = realpathSync(resolvedRunRoot);
    assertResolvedPathUnderRoot(realRunRoot, canonicalAllowedRoot);
  }
}
