// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFhvFullHistoricalAuthorizationReceipt,
  readFhvFullHistoricalAuthorizationReceipt,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  buildFhvAuthorizationClaimIssued,
  buildFhvTerminalResult,
  readFhvAuthorizationClaim,
  readFhvTerminalResult,
} from "@/lib/trader/observability/fhv-authorization-claim";
import {
  buildFhvLaunchJournal,
  readFhvLaunchJournal,
} from "@/lib/trader/observability/fhv-launch-journal";
import {
  readFhvOfficialCampaignIdentity,
  writeFhvOfficialCampaignIdentity,
} from "@/lib/trader/observability/fhv-official-campaign-identity";
import { writeFileAtomicCompareAndReplace } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

const cap = 1_048_576;
const profile = { metadataReadProfile: "CONTROL_REPLAY_TRANSITION_V1" as const };
const dirs: string[] = [];
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "fhv-bounded-native-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const auth = () =>
  buildFhvFullHistoricalAuthorizationReceipt({
    releaseSha: "a".repeat(40),
    releaseTag: "fixture",
    datasetQualificationReceiptDigest: "b".repeat(64),
    datasetDigest: "c".repeat(64),
    manifestDigest: "d".repeat(64),
    configurationFreezeDigest: "e".repeat(64),
    organizationId: "00000000-0000-4000-8000-000000000001",
    operatorId: "fixture",
    runId: "fixture-run",
    executionPurpose: "CONTROL_REPLAY",
    authorizedAtUtc: "2026-01-01T00:00:00.000Z",
  });
const cases = [
  {
    name: "authorization",
    filename: "auth.json",
    build: () => auth(),
    read: (dir: string, options?: typeof profile) =>
      Reflect.apply(readFhvFullHistoricalAuthorizationReceipt, undefined, [
        join(dir, "auth.json"),
        options,
      ]),
  },
  {
    name: "claim",
    filename: "claim.json",
    build: () =>
      buildFhvAuthorizationClaimIssued({
        authorizationReceiptDigest: auth().authorizationReceiptDigest,
        executionPurpose: "CONTROL_REPLAY",
        runId: "fixture-run",
        releaseSha: "a".repeat(40),
        datasetContentDigest: "c".repeat(64),
        manifestSemanticDigest: "d".repeat(64),
        configurationFreezeDigest: "e".repeat(64),
      }),
    read: (dir: string, options?: typeof profile) =>
      Reflect.apply(readFhvAuthorizationClaim, undefined, [join(dir, "claim.json"), options]),
  },
  {
    name: "journal",
    filename: "fhv-launch-journal.v1.json",
    build: () => buildFhvLaunchJournal({ runId: "fixture-run", walPath: "execution.wal.ndjson" }),
    read: (dir: string, options?: typeof profile) =>
      Reflect.apply(readFhvLaunchJournal, undefined, [dir, options]),
  },
  {
    name: "terminal",
    filename: "terminal.json",
    build: () =>
      buildFhvTerminalResult({
        runId: "fixture-run",
        classification: "PROTOCOL_FIXTURE",
        semanticReproDigest: "f".repeat(64),
      }),
    read: (dir: string, options?: typeof profile) =>
      Reflect.apply(readFhvTerminalResult, undefined, [join(dir, "terminal.json"), options]),
  },
  {
    name: "campaign",
    filename: "fhv-official-campaign-identity.v1.json",
    build: (dir: string) =>
      writeFhvOfficialCampaignIdentity({
        runDir: dir,
        releaseSha: "a".repeat(40),
        runId: "fixture-run",
        organizationId: "00000000-0000-4000-8000-000000000001",
        launchReceiptDigest: "f".repeat(64),
      }),
    read: (dir: string, options?: typeof profile) =>
      Reflect.apply(readFhvOfficialCampaignIdentity, undefined, [dir, options]),
  },
];
describe("Control Replay fixed profile at actual native read owners", () => {
  for (const item of cases) {
    it(`${item.name}: accepts exact limit, rejects plus one before native decode, preserves legacy read`, () => {
      const dir = root();
      const body = item.build(dir);
      const json = JSON.stringify(body);
      const path = join(dir, item.filename);
      writeFileSync(path, json + " ".repeat(cap - Buffer.byteLength(json)));
      expect(item.read(dir, profile)).toEqual(body);
      writeFileSync(path, json + " ".repeat(cap + 1 - Buffer.byteLength(json)));
      expect(() => item.read(dir, profile)).toThrowError(
        expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
      );
      expect(item.read(dir)).toEqual(body);
    });
  }
  it("bounds the actual compare reread before replacement", () => {
    const dir = root();
    const path = join(dir, "compare.json");
    const old = " ".repeat(cap + 1);
    writeFileSync(path, old);
    const input = {
      finalPath: path,
      expectedContent: "small prior snapshot",
      nextContent: "new",
      ...profile,
    };
    expect(() => writeFileAtomicCompareAndReplace(input)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
    );
    expect(readFileSync(path, "utf8")).toBe(old);
  });
});
