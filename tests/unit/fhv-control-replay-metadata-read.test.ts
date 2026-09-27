// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const observation = vi.hoisted(() => ({
  fds: new Set<number>(),
  beforeRead: undefined as (() => void) | undefined,
  chunk: undefined as number | undefined,
  readCalls: 0,
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: (...args: Parameters<typeof real.openSync>) => {
      const fd = real.openSync(...args);
      observation.fds.add(fd);
      return fd;
    },
    closeSync: (fd: number) => {
      try {
        return real.closeSync(fd);
      } finally {
        observation.fds.delete(fd);
      }
    },
    readSync: (
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset: number,
      length: number,
      position: number | null,
    ) => {
      observation.readCalls++;
      const hook = observation.beforeRead;
      observation.beforeRead = undefined;
      hook?.();
      return real.readSync(
        fd,
        buffer,
        offset,
        Math.min(length, observation.chunk ?? length),
        position,
      );
    },
  };
});
import {
  CONTROL_REPLAY_METADATA_MAX_BYTES as cap,
  readMetadataBytesSync,
  readMetadataTextSync,
  assertMetadataBytesSupported,
} from "@/lib/trader/backtest/streaming-evidence/bounded-metadata-read";
const profile = { metadataReadProfile: "CONTROL_REPLAY_TRANSITION_V1" as const };
const roots: string[] = [];
function fixture(bytes: string | Buffer) {
  const root = mkdtempSync(join(tmpdir(), "fhv-metadata-"));
  roots.push(root);
  const path = join(root, "metadata.json");
  writeFileSync(path, bytes);
  return { root, path };
}
afterEach(() => {
  expect(observation.fds.size).toBe(0);
  observation.beforeRead = undefined;
  observation.chunk = undefined;
  observation.readCalls = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("same-open-file bounded Control Replay metadata", () => {
  it("accepts the exact byte cap including multibyte UTF8 and refuses one more byte before payload reads", () => {
    const bytes = '"é"' + " ".repeat(cap - 4);
    const { path } = fixture(bytes);
    expect(Buffer.byteLength(bytes)).toBe(cap);
    expect(readMetadataTextSync(path, profile)).toBe(bytes);
    writeFileSync(path, bytes + " ");
    observation.readCalls = 0;
    expect(() => readMetadataTextSync(path, profile)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
    );
    expect(observation.readCalls).toBe(0);
    expect(readMetadataTextSync(path)).toBe(bytes + " ");
  });
  it("finishes short reads without treating a partial chunk as EOF", () => {
    const { path } = fixture("abcdef");
    observation.chunk = 1;
    expect(readMetadataTextSync(path, profile)).toBe("abcdef");
    expect(observation.readCalls).toBe(7);
  });
  it("refuses truncation after descriptor metadata with descriptor cleanup", () => {
    const { path } = fixture("abcdef");
    observation.beforeRead = () => writeFileSync(path, "a");
    expect(() => readMetadataTextSync(path, profile)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_READ_CHANGED" }),
    );
  });
  it("refuses growth after descriptor metadata, without materializing growing contents", () => {
    const { path } = fixture("a");
    observation.beforeRead = () => writeFileSync(path, "b".repeat(cap + 1));
    expect(() => readMetadataTextSync(path, profile)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
    );
    expect(observation.readCalls).toBe(2);
  });
  it("never follows a replacement pathname after opening the original snapshot", () => {
    const { root, path } = fixture("original");
    observation.beforeRead = () => {
      renameSync(path, join(root, "saved"));
      writeFileSync(path, "replacement");
    };
    try {
      expect(readMetadataTextSync(path, profile)).toBe("original");
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_READ_CHANGED" }),
      );
    }
  });
  it("rejects nonregular descriptors and closes them", () => {
    const { root } = fixture("");
    const dir = join(root, "directory");
    mkdirSync(dir);
    expect(() => readMetadataTextSync(dir, profile)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_NOT_REGULAR" }),
    );
  });
  it("opens a real FIFO with no writer without blocking, refuses and closes in a child", () => {
    const { root } = fixture("");
    const fifo = join(root, "fifo");
    execFileSync("mkfifo", [fifo]);
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
      const fs=require('node:fs'); let opened=0,closed=0;
      const open=fs.openSync,close=fs.closeSync;
      fs.openSync=(...a)=>{const fd=open(...a);if(a[0]===process.argv[1])opened++;return fd};
      fs.closeSync=(fd)=>{closed++;return close(fd)};
      const {readMetadataTextSync}=require(process.argv[2]); const before=closed;
      try{readMetadataTextSync(process.argv[1],{metadataReadProfile:'CONTROL_REPLAY_TRANSITION_V1'});process.exitCode=1}
      catch(e){process.stdout.write(JSON.stringify({code:e.code,opened,closed:closed-before}))}
    `,
        fifo,
        resolve("lib/trader/backtest/streaming-evidence/bounded-metadata-read.ts"),
      ],
      {
        cwd: process.cwd(),
        timeout: 5000,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      code: "CONTROL_REPLAY_METADATA_NOT_REGULAR",
      opened: 1,
      closed: 1,
    });
  });
  it("accepts empty bytes and bounds generated metadata; no unknown profile can bypass", () => {
    const { path } = fixture("");
    expect(readMetadataBytesSync(path, profile)).toEqual(Buffer.alloc(0));
    expect(() => assertMetadataBytesSupported(Buffer.alloc(cap + 1), profile)).toThrowError(
      expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
    );
    expect(() =>
      Reflect.apply(readMetadataBytesSync, undefined, [path, { metadataReadProfile: "UNKNOWN" }]),
    ).toThrowError(expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_PROFILE_INVALID" }));
  });
});
