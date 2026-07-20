import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { FHV_RUN_LOG_SECURITY_CONTRACT_ID } from "@/lib/trader/observability/fhv-run-log-layout";
import {
  createFhvRuntimeTraceWriter,
  detectFhvSemanticEventMutation,
  FHV_TRACE_WRITER_DEFAULT_BUFFER_LIMIT,
  recoverFhvSemanticEventsFromPartialFile,
  writePartialFhvEventLine,
} from "@/lib/trader/observability/fhv-runtime-trace-writer";
import { FHV_SEMANTIC_EVENT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-semantic-event.types";

const ORG_ID = "00000000-0000-4000-8000-0000000415a4";
const ACCOUNT_KEY = "corrective-a4";
const RUN_ID = "corrective-a4-trace-run";

function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function baseEvent(cycleId: string) {
  return {
    runId: RUN_ID,
    cycleId,
    moduleName: "paper-cycle",
    moduleVersion: "1.0.0",
    eventType: "CYCLE_COMPLETE",
    inputDigest: computeSemanticSha256Hex({ cycleId }),
    outputDigest: computeSemanticSha256Hex({ ok: true }),
    stateDigest: computeSemanticSha256Hex([]),
    timestampUtc: "2026-07-18T00:00:00.000Z",
    correlationId: `${RUN_ID}:${cycleId}`,
  };
}

describe("DEE-415 C-A4 FHV trace writer (G4)", () => {
  it("appends events append-only with monotonic seq", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-"));
    try {
      const writer = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
        bufferLimit: 2,
      });
      const first = writer.appendSemanticEvent(baseEvent("0"));
      const second = writer.appendSemanticEvent(baseEvent("1"));
      expect(first.seq).toBe(0);
      expect(second.seq).toBe(1);
      writer.flushTraceWriter();
      const raw = readFileSync(writer.eventsPath, "utf8");
      expect(raw.split("\n").filter(Boolean).length).toBe(2);
      expect(() => writer.appendSemanticEvent({ ...baseEvent("2"), seq: 1 })).toThrow(
        "SEQ_NOT_MONOTONIC",
      );
    } finally {
      removeDir(root);
    }
  });

  it("prohibits secret-like payloads", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-secret-"));
    try {
      const writer = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      expect(() =>
        writer.appendSemanticEvent({
          ...baseEvent("0"),
          outputDigest: "password=super-secret",
        }),
      ).toThrow("SECRET_PROHIBITED");
    } finally {
      removeDir(root);
    }
  });

  it("detects semantic-event digest mutation", () => {
    const events = [
      {
        schemaVersion: FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
        ...baseEvent("0"),
        seq: 0,
      },
      {
        schemaVersion: FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
        ...baseEvent("1"),
        seq: 1,
      },
    ] as const;
    const digest = computeSemanticSha256Hex(
      events.map((event) => ({
        seq: event.seq,
        eventType: event.eventType,
        moduleName: event.moduleName,
        inputDigest: event.inputDigest,
        outputDigest: event.outputDigest,
        stateDigest: event.stateDigest,
      })),
    );
    expect(detectFhvSemanticEventMutation(events, digest)).toBe(true);
    expect(
      detectFhvSemanticEventMutation([{ ...events[0], eventType: "MUTATED" }, events[1]], digest),
    ).toBe(false);
  });

  it("flushes on bounded buffer and verifies manifest digests", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-flush-"));
    try {
      const writer = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
        bufferLimit: 1,
      });
      writer.appendSemanticEvent(baseEvent("0"));
      writer.appendSemanticEvent(baseEvent("1"));
      const manifest = writer.writeRunManifest();
      expect(manifest.lastSeq).toBe(1);
      expect(writer.verifyRunManifest()).toBe(true);
      expect(FHV_TRACE_WRITER_DEFAULT_BUFFER_LIMIT).toBeGreaterThan(0);
    } finally {
      removeDir(root);
    }
  });

  it("recovers from crash-safe partial trailing line", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-partial-"));
    try {
      const writer = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      writer.appendSemanticEvent(baseEvent("0"));
      writer.flushTraceWriter();
      writePartialFhvEventLine(
        writer.eventsPath,
        '{"schemaVersion":"fhv-semantic-event/v1","runId"',
      );
      const recovered = recoverFhvSemanticEventsFromPartialFile(writer.eventsPath);
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.seq).toBe(0);
    } finally {
      removeDir(root);
    }
  });

  it("rotates event logs deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-rotate-"));
    try {
      const writer = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
        rotationBytes: 32,
      });
      writeFileSync(writer.eventsPath, "x".repeat(40));
      const rotatedPath = writer.rotateTraceLogs();
      expect(rotatedPath).toContain("events-0001.jsonl");
      expect(existsSync(writer.eventsPath)).toBe(false);
      const manifest = writer.writeRunManifest();
      expect(manifest.rotatedEventFiles).toEqual(["events-0001.jsonl"]);
    } finally {
      removeDir(root);
    }
  });

  it("resumes seq continuity from manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-resume-"));
    try {
      const firstWriter = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      firstWriter.appendSemanticEvent(baseEvent("0"));
      firstWriter.appendSemanticEvent(baseEvent("1"));
      firstWriter.writeRunManifest();

      const resumedWriter = createFhvRuntimeTraceWriter({
        root,
        organizationId: ORG_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      const resumed = resumedWriter.appendSemanticEvent(baseEvent("2"));
      expect(resumed.seq).toBe(2);
    } finally {
      removeDir(root);
    }
  });

  it("rejects SEC-SYMLINK-001 symlink run-root escape", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-trace-a4-root-"));
    const outside = mkdtempSync(join(tmpdir(), "fhv-trace-a4-outside-"));
    const linkPath = join(root, "linked-run-root");
    removeDir(linkPath);
    symlinkSync(outside, linkPath);
    try {
      expect(() =>
        createFhvRuntimeTraceWriter({
          root: linkPath,
          organizationId: ORG_ID,
          accountKey: ACCOUNT_KEY,
          runId: RUN_ID,
        }),
      ).toThrow(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:RUN_LOG_ROOT_LEAF_IS_SYMLINK`);
    } finally {
      removeDir(linkPath);
      removeDir(outside);
      removeDir(root);
    }
  });
});
