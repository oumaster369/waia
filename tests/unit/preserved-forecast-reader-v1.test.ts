// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPreservedForecastEvidenceV1 } from "../../scripts/trader/preserved-forecast-reader-v1";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "../../scripts/trader/scientific-checkpoint-key-v1";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true}); });
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dee991-reader-test-"))); roots.push(root);
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  const expected: ExpectedScientificCheckpointV1 = { releaseSha: "a".repeat(40),
    runtime: {node:process.version, os:process.platform, arch:process.arch},
    stage:"wf-forecast-batch-v1", kind:"evidence", input:{organizationId:"synthetic", offset:0} };
  const builder = vi.fn(() => [{synthetic:true}]);
  createScientificCheckpointStoreV1(root, expected.releaseSha).evidence(expected.stage, expected.input, builder);
  return {root, expected, builder, directory:join(root, deriveScientificCheckpointKeyV1(expected))};
}
describe("DEE-991 existing forecast reader cannot generate or publish", () => {
  it.each([".seal-key", "seal.json", "evidence.bin"])("refuses FIFO %s without waiting for a writer", name => {
    const {root,expected,directory} = setup();
    const path = join(name === ".seal-key" ? root : directory,name);
    unlinkSync(path); execFileSync("mkfifo",["-m","600",path]);
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("REFUSED");
  });
  it("authenticates original bytes without invoking a builder or touching contents/mtime", () => {
    const {root, expected, builder, directory} = setup();
    const paths = [join(root,".seal-key"), join(directory,"seal.json"), join(directory,"evidence.bin")];
    const before = paths.map(p => ({bytes:readFileSync(p), mtime:statSync(p).mtimeMs}));
    const result = readPreservedForecastEvidenceV1(root, expected);
    expect(result.status).toBe("AUTHENTICATED_BYTES_NOT_ADMISSION");
    expect(result.authorityGranted).toBe(false); expect(result.generationPermitted).toBe(false);
    expect(builder).toHaveBeenCalledTimes(1);
    paths.forEach((p,i) => {expect(readFileSync(p)).toEqual(before[i]!.bytes); expect(statSync(p).mtimeMs).toBe(before[i]!.mtime);});
  });
  it("reports a miss without generating evidence", () => {
    const {root,expected,builder} = setup(), before = readdirSync(root);
    const result = readPreservedForecastEvidenceV1(root, {...expected,input:{offset:32}});
    expect(result.status).toBe("MISSING"); expect(result.generationPermitted).toBe(false);
    expect(readdirSync(root)).toEqual(before); expect(builder).toHaveBeenCalledTimes(1);
  });
  it("does not create a missing root or missing signing key", () => {
    const {root, expected} = setup();
    expect(() => readPreservedForecastEvidenceV1(join(root,"absent"),expected)).toThrow();
    expect(readdirSync(root)).not.toContain("absent");
    unlinkSync(join(root,".seal-key"));
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow();
    expect(readdirSync(root)).not.toContain(".seal-key");
  });
  it("refuses tampered payload even with an intact original seal", () => {
    const {root,expected,directory} = setup(); writeFileSync(join(directory,"evidence.bin"),Buffer.from("tamper"));
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("PAYLOAD");
  });
  it("refuses tampered authentication and corrupt JSON", () => {
    const {root,expected,directory} = setup(), path = join(directory,"seal.json");
    const envelope = JSON.parse(readFileSync(path,"utf8")); envelope.signature = "0".repeat(64);
    writeFileSync(path,JSON.stringify(envelope));
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("SEAL_AUTHENTICATION");
    writeFileSync(path,"null"); expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("SEAL_ENVELOPE");
  });
  it("refuses public files and oversized payloads", () => {
    const {root,expected,directory} = setup(), path = join(directory,"evidence.bin");
    chmodSync(path,0o644); expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("PRIVATE_FILE");
    chmodSync(path,0o600); writeFileSync(path,Buffer.alloc(65537));
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow("SIZE");
  });
  it("refuses symlink roots and evidence files", () => {
    const {root,expected,directory} = setup(); symlinkSync(root,join(root,"alias"));
    expect(() => readPreservedForecastEvidenceV1(join(root,"alias"),expected)).toThrow();
    unlinkSync(join(directory,"evidence.bin")); symlinkSync(join(root,".seal-key"),join(directory,"evidence.bin"));
    expect(() => readPreservedForecastEvidenceV1(root,expected)).toThrow();
  });
  it("never accepts old terminal evidence as a forecast batch", () => {
    const {root,expected} = setup();
    expect(() => readPreservedForecastEvidenceV1(root,{...expected,stage:"wf-predictive-terminal-v1"})).toThrow("STAGE");
  });
});
