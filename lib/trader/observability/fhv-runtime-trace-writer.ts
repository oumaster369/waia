import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  FHV_LOG_SUBDIRS,
  FHV_RUN_LOG_SECURITY_CONTRACT_ID,
  FHV_SEMANTIC_EVENTS_FILE_NAME,
  resolveFhvRunLogRoot,
  resolveFhvRunManifestPath,
  resolveFhvSemanticEventsPath,
  type ResolveFhvRunLogRootInput,
} from "@/lib/trader/observability/fhv-run-log-layout";
import {
  assertFhvSemanticEventV1,
  FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
  type FhvSemanticEventV1,
} from "@/lib/trader/observability/fhv-semantic-event.types";

export const FHV_RUN_MANIFEST_SCHEMA_VERSION = "fhv-run-manifest/v1" as const;
export const FHV_TRACE_WRITER_DEFAULT_BUFFER_LIMIT = 64;
export const FHV_TRACE_WRITER_DEFAULT_ROTATION_BYTES = 1024 * 1024;

const FHV_TRACE_FORBIDDEN_PATTERNS = [
  /postgresql:\/\//i,
  /DATABASE_URL/i,
  /BEGIN (RSA |EC )?PRIVATE KEY/i,
  /api[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
] as const;

export type FhvRunManifestV1 = Readonly<{
  schemaVersion: typeof FHV_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  accountKey: string;
  lastSeq: number;
  semanticEventFile: string;
  rotatedEventFiles: readonly string[];
  files: Record<string, { sha256: string; bytes: number }>;
}>;

export type CreateFhvRuntimeTraceWriterInput = ResolveFhvRunLogRootInput & {
  resumeSeq?: number;
  bufferLimit?: number;
  rotationBytes?: number;
};

export type FhvRuntimeTraceWriter = Readonly<{
  runRoot: string;
  eventsPath: string;
  appendSemanticEvent: (
    event: Omit<FhvSemanticEventV1, "schemaVersion" | "seq"> & { seq?: number },
  ) => FhvSemanticEventV1;
  flushTraceWriter: () => void;
  rotateTraceLogs: () => string | null;
  readCommittedEvents: () => readonly FhvSemanticEventV1[];
  nextSeq: () => number;
  writeRunManifest: (extraFiles?: Record<string, string>) => FhvRunManifestV1;
  verifyRunManifest: () => boolean;
}>;

function sha256FileBytes(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function scanFhvTraceSecretViolation(serialized: string): string | null {
  for (const pattern of FHV_TRACE_FORBIDDEN_PATTERNS) {
    if (pattern.test(serialized)) {
      return pattern.source;
    }
  }
  return null;
}

function serializeEventLine(event: FhvSemanticEventV1): string {
  const serialized = `${JSON.stringify(event)}\n`;
  const violation = scanFhvTraceSecretViolation(serialized);
  if (violation) {
    throw new Error(`FHV_TRACE_WRITER:SECRET_PROHIBITED:${violation}`);
  }
  return serialized;
}

function parseEventLine(line: string, lineNumber: number): FhvSemanticEventV1 | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    assertFhvSemanticEventV1(parsed);
    return parsed;
  } catch {
    throw new Error(`FHV_TRACE_WRITER:PARTIAL_LINE_RECOVERY_REQUIRED:${lineNumber}`);
  }
}

export function readFhvSemanticEventsFromFile(filePath: string): readonly FhvSemanticEventV1[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const events: FhvSemanticEventV1[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = parseEventLine(line, index + 1);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

export function recoverFhvSemanticEventsFromPartialFile(
  filePath: string,
): readonly FhvSemanticEventV1[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const events: FhvSemanticEventV1[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = parseEventLine(line, index + 1);
      if (parsed) {
        events.push(parsed);
      }
    } catch {
      break;
    }
  }
  return events;
}

function loadResumeSeq(manifestPath: string, eventsPath: string, explicit?: number): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvRunManifestV1;
    if (typeof manifest.lastSeq === "number") {
      return manifest.lastSeq;
    }
  }
  const events = recoverFhvSemanticEventsFromPartialFile(eventsPath);
  return events.at(-1)?.seq ?? -1;
}

function appendBytesAtomic(filePath: string, bytes: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileAtomic(filePath, bytes);
    return;
  }
  appendFileSync(filePath, bytes, "utf8");
}

export function createFhvRuntimeTraceWriter(
  input: CreateFhvRuntimeTraceWriterInput,
): FhvRuntimeTraceWriter {
  const runRoot = resolveFhvRunLogRoot(input);
  const eventsPath = resolveFhvSemanticEventsPath(runRoot);
  const manifestPath = resolveFhvRunManifestPath(runRoot);
  const bufferLimit = input.bufferLimit ?? FHV_TRACE_WRITER_DEFAULT_BUFFER_LIMIT;
  const rotationBytes = input.rotationBytes ?? FHV_TRACE_WRITER_DEFAULT_ROTATION_BYTES;

  mkdirSync(path.dirname(eventsPath), { recursive: true });
  mkdirSync(path.dirname(manifestPath), { recursive: true });

  let nextSeqValue = loadResumeSeq(manifestPath, eventsPath, input.resumeSeq);
  let buffer: string[] = [];
  const rotatedEventFiles: string[] = [];

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvRunManifestV1;
    if (Array.isArray(manifest.rotatedEventFiles)) {
      rotatedEventFiles.push(...manifest.rotatedEventFiles);
    }
  }

  const flushTraceWriter = (): void => {
    if (buffer.length === 0) {
      return;
    }
    appendBytesAtomic(eventsPath, buffer.join(""));
    buffer = [];
  };

  const rotateTraceLogs = (): string | null => {
    flushTraceWriter();
    if (!existsSync(eventsPath)) {
      return null;
    }
    const size = statSync(eventsPath).size;
    if (size < rotationBytes) {
      return null;
    }
    const rotationIndex = rotatedEventFiles.length + 1;
    const rotatedName = `events-${String(rotationIndex).padStart(4, "0")}.jsonl`;
    const rotatedPath = path.join(path.dirname(eventsPath), rotatedName);
    renameSync(eventsPath, rotatedPath);
    rotatedEventFiles.push(rotatedName);
    return rotatedPath;
  };

  const appendSemanticEvent = (
    event: Omit<FhvSemanticEventV1, "schemaVersion" | "seq"> & { seq?: number },
  ): FhvSemanticEventV1 => {
    if (event.seq !== undefined) {
      if (event.seq <= nextSeqValue) {
        throw new Error("FHV_TRACE_WRITER:SEQ_NOT_MONOTONIC");
      }
      nextSeqValue = event.seq;
    } else {
      nextSeqValue += 1;
    }

    const committed: FhvSemanticEventV1 = {
      schemaVersion: FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
      ...event,
      seq: nextSeqValue,
    };
    assertFhvSemanticEventV1(committed);

    buffer.push(serializeEventLine(committed));
    if (buffer.length >= bufferLimit) {
      flushTraceWriter();
    }
    return committed;
  };

  const readCommittedEvents = (): readonly FhvSemanticEventV1[] => {
    flushTraceWriter();
    const active = recoverFhvSemanticEventsFromPartialFile(eventsPath);
    const rotated = rotatedEventFiles.flatMap((fileName) =>
      recoverFhvSemanticEventsFromPartialFile(path.join(path.dirname(eventsPath), fileName)),
    );
    return [...rotated, ...active].sort((left, right) => left.seq - right.seq);
  };

  const writeRunManifest = (extraFiles: Record<string, string> = {}): FhvRunManifestV1 => {
    flushTraceWriter();
    const files: Record<string, { sha256: string; bytes: number }> = {};

    const recordFile = (relativePath: string, absolutePath: string) => {
      if (!existsSync(absolutePath)) {
        return;
      }
      files[relativePath] = {
        sha256: sha256FileBytes(absolutePath),
        bytes: statSync(absolutePath).size,
      };
    };

    recordFile(
      path.join(FHV_LOG_SUBDIRS.semanticEvents, FHV_SEMANTIC_EVENTS_FILE_NAME),
      eventsPath,
    );
    for (const rotated of rotatedEventFiles) {
      recordFile(
        path.join(FHV_LOG_SUBDIRS.semanticEvents, rotated),
        path.join(path.dirname(eventsPath), rotated),
      );
    }
    for (const [relativePath, absolutePath] of Object.entries(extraFiles)) {
      recordFile(relativePath, absolutePath);
    }

    const manifest: FhvRunManifestV1 = {
      schemaVersion: FHV_RUN_MANIFEST_SCHEMA_VERSION,
      runId: input.runId,
      organizationId: input.organizationId,
      accountKey: input.accountKey,
      lastSeq: nextSeqValue,
      semanticEventFile: path.join(FHV_LOG_SUBDIRS.semanticEvents, FHV_SEMANTIC_EVENTS_FILE_NAME),
      rotatedEventFiles,
      files,
    };

    writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  };

  const verifyRunManifest = (): boolean => {
    if (!existsSync(manifestPath)) {
      return false;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvRunManifestV1;
    for (const [relativePath, entry] of Object.entries(manifest.files)) {
      const absolutePath = path.join(runRoot, relativePath);
      if (!existsSync(absolutePath)) {
        return false;
      }
      if (sha256FileBytes(absolutePath) !== entry.sha256) {
        return false;
      }
      if (statSync(absolutePath).size !== entry.bytes) {
        return false;
      }
    }
    return true;
  };

  return {
    runRoot,
    eventsPath,
    appendSemanticEvent,
    flushTraceWriter,
    rotateTraceLogs,
    readCommittedEvents,
    nextSeq: () => nextSeqValue + 1,
    writeRunManifest,
    verifyRunManifest,
  };
}

export function appendSemanticEvent(
  writer: FhvRuntimeTraceWriter,
  event: Omit<FhvSemanticEventV1, "schemaVersion" | "seq"> & { seq?: number },
): FhvSemanticEventV1 {
  return writer.appendSemanticEvent(event);
}

export function flushTraceWriter(writer: FhvRuntimeTraceWriter): void {
  writer.flushTraceWriter();
}

export function rotateTraceLogs(writer: FhvRuntimeTraceWriter): string | null {
  return writer.rotateTraceLogs();
}

export function computeFhvSemanticEventsDigest(events: readonly FhvSemanticEventV1[]): string {
  return computeSemanticSha256Hex(
    events.map((event) => ({
      seq: event.seq,
      eventType: event.eventType,
      moduleName: event.moduleName,
      inputDigest: event.inputDigest,
      outputDigest: event.outputDigest,
      stateDigest: event.stateDigest,
    })),
  );
}

export function detectFhvSemanticEventMutation(
  events: readonly FhvSemanticEventV1[],
  expectedDigest: string,
): boolean {
  return computeFhvSemanticEventsDigest(events) === expectedDigest;
}

export function assertFhvTraceWriterRunRootSecure(runRoot: string, allowedRoot: string): void {
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedAllowedRoot = path.resolve(allowedRoot);
  if (existsSync(resolvedRunRoot) && lstatSync(resolvedRunRoot).isSymbolicLink()) {
    throw new Error(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:RUN_ROOT_LEAF_IS_SYMLINK`);
  }
  const rootWithSep = resolvedAllowedRoot.endsWith(path.sep)
    ? resolvedAllowedRoot
    : `${resolvedAllowedRoot}${path.sep}`;
  if (resolvedRunRoot !== resolvedAllowedRoot && !resolvedRunRoot.startsWith(rootWithSep)) {
    throw new Error(`${FHV_RUN_LOG_SECURITY_CONTRACT_ID}:PATH_TRAVERSAL`);
  }
}

export function writePartialFhvEventLine(filePath: string, partial: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, partial, "utf8");
}
