import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(process.cwd());
const productionRoots = ["app", "lib", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const allowedOrderEffectCalls = new Map([
  [
    "lib/trader/execution/v2/connector-dispatch.ts",
    ["connector.placeOrder("],
  ],
  [
    "lib/trader/connectors/htx/htx-exchange-connector.ts",
    ["this.client.placeOrder("],
  ],
]);
const allowedCancelCalls = new Map([
  [
    "lib/trader/connectors/htx/client.ts",
    ["HTX_ENDPOINTS.cancelOrder("],
  ],
  [
    "lib/trader/connectors/htx/htx-exchange-connector.ts",
    ["this.client.cancelOrder("],
  ],
  [
    "lib/trader/guardian/htr-breach-partial-entry-cancellation.ts",
    ["input.cancelOrder("],
  ],
]);
const expectedLegacyConsumers = new Set([
  "lib/trader/live/run-live-cycle.ts",
  "lib/trader/paper/paper-cycle-runner.ts",
  "lib/trader/research/capital-path-trace-harness.ts",
]);

function filesUnder(path: string): string[] {
  const absolute = resolve(root, path);
  const files: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const target = resolve(absolute, entry);
    if (statSync(target).isDirectory()) files.push(...filesUnder(relative(root, target)));
    else if (sourceExtensions.has(target.slice(target.lastIndexOf(".")))) files.push(target);
  }
  return files;
}

type CallSite = { file: string; line: number; expression: string };

function matchingCalls(files: readonly string[], expression: RegExp): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of files) {
    const path = relative(root, file);
    for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
      for (const match of line.matchAll(expression)) {
        sites.push({ file: path, line: index + 1, expression: match[0] });
      }
    }
  }
  return sites;
}

const productionFiles = productionRoots.flatMap(filesUnder).filter((file) =>
  relative(root, file) !== "scripts/trader/validate-execution-v2-consumer-graph.ts");
const orderEffectCalls = matchingCalls(
  productionFiles,
  /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.placeOrder\s*\(/g,
);
const futuresEffectCalls = matchingCalls(
  productionFiles,
  /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.placeFuturesOrder\s*\(/g,
);
const legacyConsumers = matchingCalls(productionFiles, /\.submitOrder\s*\(/g);
const cancelCalls = matchingCalls(
  productionFiles,
  /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.cancelOrder\s*\(/g,
);

const violations = orderEffectCalls.filter((site) =>
  !(allowedOrderEffectCalls.get(site.file) ?? []).some((allowed) =>
    site.expression.replace(/\s/g, "").includes(allowed)));
for (const site of futuresEffectCalls) violations.push(site);
for (const site of cancelCalls) {
  if (!(allowedCancelCalls.get(site.file) ?? []).some((allowed) =>
    site.expression.replace(/\s/g, "").includes(allowed))) {
    violations.push(site);
  }
}
const missingLegacyConsumers = [...expectedLegacyConsumers].filter((file) =>
  !legacyConsumers.some((site) => site.file === file));
const unknownLegacyConsumers = legacyConsumers.filter((site) =>
  !expectedLegacyConsumers.has(site.file));

const legacyBoundary = readFileSync(
  resolve(root, "lib/trader/execution/execution-service.ts"),
  "utf8",
);
const failClosed = legacyBoundary.includes("LEGACY_ORDER_SUBMISSION_DISABLED") &&
  legacyBoundary.includes('status: "execution_v2_required"') &&
  legacyBoundary.includes("LEGACY_ORDER_CANCELLATION_DISABLED");
if (!failClosed) {
  violations.push({
    file: "lib/trader/execution/execution-service.ts",
    line: 0,
    expression: "missing fail-closed legacy boundary",
  });
}
violations.push(...unknownLegacyConsumers);
if (missingLegacyConsumers.length > 0) {
  violations.push(...missingLegacyConsumers.map((file) => ({
    file,
    line: 0,
    expression: "expected legacy consumer disappeared without graph update",
  })));
}

const report = {
  schemaVersion: "execution-v2-consumer-graph/v1",
  orderEffectCalls,
  legacyConsumers: legacyConsumers.map((site) => ({
    ...site,
    disposition: "FAIL_CLOSED_AT_LEGACY_BOUNDARY",
  })),
  futuresEffectCalls,
  cancelCalls: cancelCalls.map((site) => ({
    ...site,
    disposition: site.file === "lib/trader/connectors/htx/htx-exchange-connector.ts"
      ? "V2_RECOVERY_ONLY_NETWORK_EFFECT"
      : site.file === "lib/trader/connectors/htx/client.ts"
        ? "TRANSPORT_ENDPOINT_CONSTRUCTION_ONLY"
        : "FAIL_CLOSED_APPLICATION_COORDINATOR",
  })),
  failClosedLegacyBoundary: failClosed,
  violations,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (violations.length > 0) process.exitCode = 1;
