/**
 * HTR-WP10 — cwd-bound candidate writer child process.
 *
 * Started with cwd set to the validated output directory. Writes only fixed
 * relative basenames using exclusive no-follow opens. Never resolves the
 * original user-supplied output pathname.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";

export const HTR_WP10_WRITER_CHILD_INPUT_SCHEMA_VERSION = "htr_wp10_writer_child_input_v1";
export const HTR_WP10_CANDIDATE_COMPLETION_SCHEMA_VERSION = "htr_wp10_candidate_completion_v1";

export const HTR_WP10_CANDIDATE_WRITE_ORDER = [
  "manifest.json",
  "README.md",
  "provenance.json",
  "staging-manifest.json",
  "completion.json",
] as const;

export type Wp10WriterChildInput = {
  schemaVersion: typeof HTR_WP10_WRITER_CHILD_INPUT_SCHEMA_VERSION;
  expectedIdentity: { dev: number; ino: number };
  workCommitSha: string;
  barrier?: boolean;
  testInjectFailAfter?: (typeof HTR_WP10_CANDIDATE_WRITE_ORDER)[number];
  files: Record<(typeof HTR_WP10_CANDIDATE_WRITE_ORDER)[number], string>;
};

type FsIdentity = { dev: number; ino: number };

function getCwdIdentity(): FsIdentity {
  const st = fs.lstatSync(".");
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(left: FsIdentity, right: FsIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertNoFollowAvailable(): void {
  if (!fs.constants.O_NOFOLLOW) {
    throw new Error("WP10_WRITER_NOFOLLOW_UNAVAILABLE");
  }
}

function writeRelativeExclusiveNoFollow(relativePath: string, content: string): void {
  assertNoFollowAvailable();
  const flags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(relativePath, flags, 0o644);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(): void {
  const fd = fs.openSync(".", fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function waitForBarrierGo(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error("WP10_WRITER_CHILD_BARRIER_IPC_UNAVAILABLE"));
      return;
    }
    const onMessage = (message: unknown): void => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as { type: string }).type === "GO"
      ) {
        process.off("message", onMessage);
        resolve();
      }
    };
    process.on("message", onMessage);
    process.send?.({ type: "READY" });
  });
}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

async function main(): Promise<void> {
  const raw = readStdin();
  const input = JSON.parse(raw) as Wp10WriterChildInput;

  if (input.schemaVersion !== HTR_WP10_WRITER_CHILD_INPUT_SCHEMA_VERSION) {
    throw new Error("WP10_WRITER_CHILD_INPUT_SCHEMA_MISMATCH");
  }

  const cwdIdentity = getCwdIdentity();
  if (!identitiesEqual(cwdIdentity, input.expectedIdentity)) {
    throw new Error("WP10_WRITER_CHILD_CWD_IDENTITY_MISMATCH");
  }

  if (input.barrier) {
    await waitForBarrierGo();
  }

  const testMode = process.env.WP10_WRITER_TEST_MODE === "1";

  for (const fileName of HTR_WP10_CANDIDATE_WRITE_ORDER) {
    if (testMode && input.testInjectFailAfter === fileName) {
      throw new Error(`WP10_WRITER_TEST_INJECTED_FAIL_AFTER_${fileName}`);
    }
    writeRelativeExclusiveNoFollow(fileName, input.files[fileName]);
  }

  fsyncDirectory();
}

if (process.env.WP10_WRITER_CHILD === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp10-writer-child] failed:", error);
    process.exitCode = 1;
  });
}

export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
