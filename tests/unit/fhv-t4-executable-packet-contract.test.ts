import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FHV_T4A_OPERATOR_STEPS,
  fhvT4aOperatorReleaseCheckoutIdentityArgs,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
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
  it("maps every contract package script to an existing package.json script", () => {
    const commands = new Set(
      FHV_T4A_OPERATOR_STEPS.flatMap((step) => {
        if (step.commandOwner.kind !== "package") {
          return [];
        }
        return [step.commandOwner.command];
      }),
    );
    expect(commands.size).toBeGreaterThan(10);
    for (const command of commands) {
      expect(PKG.scripts[command], `missing package script ${command}`).toBeTruthy();
    }
  });

  it("maps every contract scripts/ops path to an existing file", () => {
    const scripts = new Set(
      FHV_T4A_OPERATOR_STEPS.flatMap((step) => {
        if (step.commandOwner.kind !== "script") {
          return [];
        }
        if (!step.commandOwner.path.startsWith("scripts/")) {
          return [];
        }
        return [step.commandOwner.path];
      }),
    );
    expect(scripts.size).toBeGreaterThan(5);
    for (const script of scripts) {
      expect(readFileSync(join(ROOT, script), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("requires wait-paused/wait-final identity + timeout in contract", () => {
    for (const sub of ["wait-paused", "wait-final"] as const) {
      const step = FHV_T4A_OPERATOR_STEPS.find(
        (entry) =>
          entry.commandOwner.kind === "package" && entry.commandOwner.command.endsWith(sub),
      );
      expect(step, sub).toBeTruthy();
      const body = readFileSync(PACKET, "utf8");
      expect(body).toContain(`trader:fhv:t4:${sub}`);
      expect(body).toContain("--timeout-ms 300000");
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
    expect(
      FHV_T4A_OPERATOR_STEPS.some(
        (step) =>
          step.commandOwner.kind === "package" &&
          step.commandOwner.command === "trader:fhv:rehearsal",
      ),
    ).toBe(true);
    expect(
      FHV_T4A_OPERATOR_STEPS.some(
        (step) =>
          step.commandOwner.kind === "script" &&
          step.commandOwner.path.includes("fhv-service-user-install-deps.sh"),
      ),
    ).toBe(true);
    const step25 = FHV_T4A_OPERATOR_STEPS.find((step) => step.step === 25);
    expect(step25?.commandOwner.kind).toBe("script");
    if (step25?.commandOwner.kind === "script") {
      expect(step25.commandOwner.path).toContain("fhv-t4-campaign-systemd-identity-read.sh");
    }
  });

  it("documents the exact PRE→STOP→POST state machine and POST order", () => {
    const body = readFileSync(PACKET, "utf8");
    expect(body.indexOf("PRE_AUTHORIZED_READ_ONLY_PHASE")).toBeLessThan(
      body.indexOf("## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`"),
    );
    expect(body.indexOf("## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`")).toBeLessThan(
      body.indexOf("POST_AUTHORIZED_T4A_PHASE"),
    );
    expect(body.indexOf("post-auth-before-disconnect")).toBeLessThan(
      body.indexOf("post-reconnect-finalize"),
    );
    expect(body).toContain("capture-continuity-before");
    const contractOrder = FHV_T4A_OPERATOR_STEPS.map((step) => step.name);
    expect(contractOrder[0]).toMatch(/authorization/i);
    expect(contractOrder[25]).toMatch(/continuity-before/i);
    expect(contractOrder[31]).toMatch(/ceremony|rollback|seal/i);
    expect(fhvT4aOperatorReleaseCheckoutIdentityArgs()).toContain("--git-bin");
  });
});
