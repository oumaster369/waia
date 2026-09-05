// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const proposalScript = "scripts/trader/historical-simulation-v2-prepare-proposal.ts";
const launchScript = "scripts/trader/historical-simulation-v2-launch-approved.ts";
const loaderArgs = ["--import", "tsx", "--conditions=react-server"];

/** Real production loader, no Vite transform/mocks, no inherited credentials. */
function invoke(args: string[]) {
  return spawnSync(process.execPath, [...loaderArgs, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      WAIA_TRADER_CLI: "1",
    },
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 512 * 1024,
  });
}

describe("Historical CLI startup through the actual Node/tsx entrypoint", () => {
  for (const script of [proposalScript, launchScript]) {
    it(`${script} loads and fails closed before DB access without a URI`, () => {
      const result = invoke([script]);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_URL_POSTGRES_SESSION",
      );
      expect(result.stderr).not.toMatch(/TransformError|Top-level await/);
    }, 30_000);
  }

  it("does not run the proposal on import", () => {
    const result = invoke(["--input-type=commonjs", "-e", [
      `const cli = require('./${proposalScript}');`,
      "if (typeof cli.runHistoricalTechnicalProposalMainV2 !== 'function') throw Error('MAIN_EXPORT');",
      "process.stdout.write('IMPORTED_WITHOUT_EXECUTION');",
    ].join("\n")]);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("IMPORTED_WITHOUT_EXECUTION");
  }, 30_000);
});
