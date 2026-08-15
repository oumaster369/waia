/**
 * Off-main-thread destination SHA-256 worker.
 * Hashes only the destination file. Never hashes the live source.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const CHUNK_BYTES = 1 << 20;

function fail(code, message) {
  parentPort.postMessage({ ok: false, code, message });
}

async function main() {
  const destPath = workerData?.destPath;
  const expectedBytes = workerData?.expectedBytes;
  const delayMs = workerData?.delayMs;
  if (typeof delayMs === "number" && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (typeof destPath !== "string" || destPath.length === 0) {
    fail("FHV_DEST_SHA_PATH_INVALID", "destination path missing");
    return;
  }
  if (typeof expectedBytes !== "number" || !Number.isInteger(expectedBytes) || expectedBytes < 0) {
    fail("FHV_DEST_SHA_SIZE_INVALID", "expectedBytes missing or invalid");
    return;
  }
  let size;
  try {
    size = statSync(destPath).size;
  } catch (error) {
    fail("FHV_DEST_SHA_READ_FAILED", `stat failed: ${String(error)}`);
    return;
  }
  if (size !== expectedBytes) {
    fail("FHV_DEST_SHA_SIZE_MISMATCH", `destination size ${size} != expected ${expectedBytes}`);
    return;
  }
  const hash = createHash("sha256");
  let fd = null;
  let byteCount = 0;
  try {
    fd = openSync(destPath, "r");
    const buf = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, byteCount);
      if (n <= 0) {
        break;
      }
      hash.update(buf.subarray(0, n));
      byteCount += n;
    }
  } catch (error) {
    fail("FHV_DEST_SHA_READ_FAILED", `read failed: ${String(error)}`);
    return;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
  if (byteCount !== expectedBytes) {
    fail("FHV_DEST_SHA_SHORT_READ", `short read: got ${byteCount} expected ${expectedBytes}`);
    return;
  }
  parentPort.postMessage({
    ok: true,
    digest: hash.digest("hex"),
    byteCount,
  });
}

main().catch((error) => {
  fail("FHV_DEST_SHA_WORKER_DIED", String(error));
});
