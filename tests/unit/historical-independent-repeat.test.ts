import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repeatConfig, writeExclusiveEvidence } from "../helpers/historical-independent-repeat";

const dirs: string[] = [];
function config() {
  const dir = realpathSync(mkdtempSync(join(resolve(tmpdir()), "waia-historical-repeat-")));
  chmodSync(dir, 0o700); dirs.push(dir);
  return { WAIA_LOCAL_HISTORICAL_REPEAT: "1", WAIA_PG_INTEGRATION: "1",
    WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT: dir };
}
const url = "postgresql://local:local@127.0.0.1:55446/waia_hsv2_it_repeat_v1_a";
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("local independent historical repeat admission", () => {
  it("leaves default CI untouched and refuses orphan output", () => {
    expect(repeatConfig({}, "")).toBeNull();
    expect(() => repeatConfig({ WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT: "/tmp/x" }, url)).toThrow();
  });
  it("requires explicit local 35-cycle integration admission", () => {
    const env = config();
    expect(repeatConfig(env, url)?.database).toBe("waia_hsv2_it_repeat_v1_a");
    for (const overrides of [{ WAIA_PG_INTEGRATION: "0" },
      { WAIA_LOCAL_HISTORICAL_REPEAT: "true" }, { WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF: "1" }]) {
      expect(() => repeatConfig({ ...env, ...overrides }, url)).toThrow();
    }
  });
  it.each([
    url.replace("127.0.0.1", "db.example.com"), url.replace("55446", "6543"),
    url.replace("waia_hsv2_it_repeat_v1_a", "postgres"), `${url}?host=db.example.com`,
    url.replace("postgresql:", "https:"), `${url}#x`,
  ])("rejects unbound database %s", invalid => { expect(() => repeatConfig(config(), invalid)).toThrow(); });
  it("requires private owned actual directory, not a link", () => {
    const env = config(); const dir = env.WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT;
    chmodSync(dir, 0o755);
    expect(() => repeatConfig(env, url)).toThrow();
    chmodSync(dir, 0o700);
    const link = join(dir, "waia-historical-repeat-link"); symlinkSync(dir, link);
    expect(() => repeatConfig({ ...env, WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT: link }, url)).toThrow();
  });
  it("writes mode0600 exclusively without replacing prior or symlink evidence", () => {
    const env = config(); const path = join(env.WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT, "test.json");
    writeExclusiveEvidence(path, "original");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeExclusiveEvidence(path, "changed")).toThrow();
    const link = `${path}.link`; symlinkSync(path, link);
    expect(() => writeExclusiveEvidence(link, "changed")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("original");
  });
});
