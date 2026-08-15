import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { Worker } from "node:worker_threads";
import { join } from "node:path";

export class FhvDestinationShaVerifierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvDestinationShaVerifierError";
  }
}

export type FhvDestinationShaVerifierRequest = Readonly<{
  runId: string;
  epochId: number;
  generation: number;
  destPath: string;
  expectedBytes: number;
  fencingGeneration: number;
  /** Test-only: stall the worker so the main thread can prove progress. */
  delayMs?: number;
}>;

export type FhvDestinationShaVerifierResult = Readonly<{
  digest: string;
  byteCount: number;
  destPath: string;
  runId: string;
  epochId: number;
  generation: number;
  fencingGeneration: number;
}>;

function workerScriptPath(): string {
  return join(process.cwd(), "lib/trader/observability/fhv-destination-sha-worker.mjs");
}

/**
 * SHA-256 the checkpoint DESTINATION file on a Worker Thread.
 * Must never run createHash.update / dest file traversal on the event-loop thread.
 */
export function verifyFhvDestinationShaOffMainThread(
  input: FhvDestinationShaVerifierRequest,
): Promise<FhvDestinationShaVerifierResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerScriptPath(), {
      workerData: {
        destPath: input.destPath,
        expectedBytes: input.expectedBytes,
        delayMs: input.delayMs ?? 0,
      },
    });

    const fail = (code: string, message: string): void => {
      if (settled) return;
      settled = true;
      void worker.terminate().catch(() => undefined);
      reject(new FhvDestinationShaVerifierError(code, message));
    };

    worker.on("message", (message: unknown) => {
      if (settled) return;
      settled = true;
      void worker.terminate().catch(() => undefined);
      if (!message || typeof message !== "object") {
        reject(
          new FhvDestinationShaVerifierError(
            "FHV_DEST_SHA_MALFORMED_RESULT",
            "verifier returned a non-object result",
          ),
        );
        return;
      }
      const payload = message as {
        ok?: boolean;
        code?: string;
        message?: string;
        digest?: string;
        byteCount?: number;
      };
      if (payload.ok !== true) {
        reject(
          new FhvDestinationShaVerifierError(
            payload.code ?? "FHV_DEST_SHA_VERIFIER_FAILED",
            payload.message ?? "destination SHA verifier failed",
          ),
        );
        return;
      }
      if (typeof payload.digest !== "string" || payload.digest.length !== 64) {
        reject(
          new FhvDestinationShaVerifierError(
            "FHV_DEST_SHA_MALFORMED_RESULT",
            "verifier digest missing",
          ),
        );
        return;
      }
      if (payload.byteCount !== input.expectedBytes) {
        reject(
          new FhvDestinationShaVerifierError(
            "FHV_DEST_SHA_SIZE_MISMATCH",
            `verifier byteCount ${String(payload.byteCount)} != expected ${input.expectedBytes}`,
          ),
        );
        return;
      }
      resolve({
        digest: payload.digest,
        byteCount: payload.byteCount,
        destPath: input.destPath,
        runId: input.runId,
        epochId: input.epochId,
        generation: input.generation,
        fencingGeneration: input.fencingGeneration,
      });
    });

    worker.on("error", (error) => {
      fail("FHV_DEST_SHA_WORKER_DIED", String(error));
    });

    worker.on("exit", (code) => {
      if (settled) return;
      fail(
        "FHV_DEST_SHA_WORKER_EXIT",
        `destination SHA worker exited with code ${code} before posting a result`,
      );
    });
  });
}
