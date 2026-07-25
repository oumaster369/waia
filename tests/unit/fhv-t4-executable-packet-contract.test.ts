import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveFhvT4ClosureCliConfig } from "@/scripts/trader/fhv-t4-closure-cli";
import { resolveFhvT4OperatorCliConfig } from "@/scripts/trader/fhv-t4-operator-cli";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const REQUIRED_WAIT_FLAGS = [
  "--run-root",
  "--run-id",
  "--organization-id",
  "--target-sha",
  "--timeout-ms",
] as const;

function extractBashBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function extractPackageCommands(block: string): string[] {
  const commands: string[] = [];
  const regex = /(?:^|\s)(trader:fhv:[a-z0-9:-]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block)) !== null) {
    const command = match[1]!;
    if (command.endsWith(":") || command.includes("<") || command.includes(">")) {
      continue;
    }
    commands.push(command);
  }
  return commands;
}

function extractScriptPaths(block: string): string[] {
  return [
    ...block.matchAll(
      /(?:^|\s|\$\{FHV_(?:LOCAL_RELEASE_ROOT|REPO_ROOT)\}\/)(scripts\/ops\/[^\s\\"']+)/gm,
    ),
  ].map((m) => m[1]!);
}

describe("T4 packet V5 executable parser contract (DEE-436)", () => {
  it("maps every packet package script to an existing package.json script", () => {
    const body = readFileSync(PACKET, "utf8");
    const commands = new Set(extractBashBlocks(body).flatMap(extractPackageCommands));
    expect(commands.size).toBeGreaterThan(10);
    for (const command of commands) {
      expect(PKG.scripts[command], `missing package script ${command}`).toBeTruthy();
    }
  });

  it("maps every packet scripts/ops path to an existing file", () => {
    const body = readFileSync(PACKET, "utf8");
    const scripts = new Set(extractBashBlocks(body).flatMap(extractScriptPaths));
    expect(scripts.size).toBeGreaterThan(5);
    for (const script of scripts) {
      expect(readFileSync(join(ROOT, script), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("requires wait-paused/wait-final identity + timeout exactly as Packet V5 supplies", () => {
    const body = readFileSync(PACKET, "utf8");
    for (const sub of ["wait-paused", "wait-final"] as const) {
      const idx = body.indexOf(`trader:fhv:t4:${sub}`);
      expect(idx).toBeGreaterThan(-1);
      const window = body.slice(idx, idx + 500);
      for (const flag of REQUIRED_WAIT_FLAGS) {
        expect(window, `${sub} missing ${flag}`).toContain(flag);
      }
      expect(window).toContain("--timeout-ms 300000");
      const config = resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
        sub,
        "--run-root",
        "/tmp/run",
        "--run-id",
        "run",
        "--organization-id",
        "00000000-0000-4000-8000-000000000001",
        "--target-sha",
        "a".repeat(40),
        "--timeout-ms",
        "300000",
      ]);
      expect(config.timeoutMs).toBe(300000);
      expect(config.runId).toBe("run");
    }
  });

  it("forbids secret argv and bare pnpm in executable blocks", () => {
    const body = readFileSync(PACKET, "utf8");
    for (const block of extractBashBlocks(body)) {
      expect(block).not.toMatch(/--command-secret|--tunnel-secret/);
      const withoutCorepack = block.replaceAll("corepack pnpm@10", "");
      expect(withoutCorepack).not.toMatch(/\bpnpm\b/);
      expect(block).not.toMatch(/\|\|\s*true/);
      expect(block).not.toMatch(/chown "\$\{FHV_SERVICE_USER\}:\$\{FHV_SERVICE_USER\}"/);
    }
  });

  it("rejects operator secret argv flags at parser level", () => {
    expect(() =>
      resolveFhvT4OperatorCliConfig({} as NodeJS.ProcessEnv, [
        "status",
        "--run-root",
        "/tmp/x",
        "--command-secret",
        "leak",
      ]),
    ).toThrow(/secret|forbidden|unsupported|unknown/i);
  });

  it("does not require reference checkout or invalid origin test syntax in pre-auth", () => {
    const body = readFileSync(PACKET, "utf8");
    const executable = body.split("## NON_EXECUTABLE")[0] ?? body;
    expect(executable).not.toContain("FHV_REFERENCE_REPO_ROOT");
    expect(executable).not.toMatch(/test "\$\{FHV_ORIGIN_URL\}" != \*:\*@\*/);
    expect(body).toContain("fhv-validate-origin-url.sh");
    expect(body).toContain("fhv-t4-host-preflight.sh");
    expect(body).toContain("fhv-service-user-checkout.sh");
    expect(executable).toContain("fhv-t4a-operator.sh pre-auth");
  });

  it("documents observer-before-arm and completed campaign identity readers", () => {
    const body = readFileSync(PACKET, "utf8");
    expect(body.indexOf("14–17")).toBeLessThan(body.indexOf("18–21"));
    expect(body).toContain("fhv-t4-campaign-systemd-identity-read.sh");
    expect(body).toContain("--artifact-root");
    expect(body).toContain("fhv-service-user-install-deps.sh");
  });

  it("documents the exact PRE→STOP→POST state machine and POST order", () => {
    const body = readFileSync(PACKET, "utf8");
    const executable = body.split("## NON_EXECUTABLE")[0] ?? body;
    const reference = body.split("## NON_EXECUTABLE")[1] ?? "";
    expect(executable.indexOf("PRE_AUTHORIZED_READ_ONLY_PHASE")).toBeLessThan(
      executable.indexOf("## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`"),
    );
    expect(executable.indexOf("## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`")).toBeLessThan(
      executable.indexOf("POST_AUTHORIZED_T4A_PHASE"),
    );
    expect(executable.indexOf("post-auth-before-disconnect")).toBeLessThan(
      executable.indexOf("post-reconnect-finalize"),
    );
    expect(executable).toContain("capture-continuity-before");
    const referenceOrder = [
      "fhv-validate-origin-url.sh",
      "fhv-service-user-checkout.sh",
      "fhv-release-checkout-identity.sh",
      "fhv-service-user-install-deps.sh",
      "trader:fhv:rehearsal",
      "record-checkout-identity",
      "render-units.sh",
      "install-units.sh",
      "fhv-systemd-record-deploy",
      "ingest-host-probe",
      "verify-deployment",
      "trader:fhv:t4:arm-pause",
      "trader:fhv:t4:resume",
      "fhv-t4-resume-campaign-root.sh",
      "fhv-t4-campaign-wait-completed.sh",
      "capture-continuity-before",
      "capture-continuity-after",
      "verify-ceremony",
    ];
    let cursor = -1;
    for (const token of referenceOrder) {
      const next = reference.indexOf(token, cursor + 1);
      expect(next, `reference order broken at ${token}`).toBeGreaterThan(cursor);
      cursor = next;
    }
  });
});
