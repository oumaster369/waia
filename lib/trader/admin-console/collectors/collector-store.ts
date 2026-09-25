import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import type { FearGreedRow } from "@/lib/trader/admin-console/collectors/fear-greed-rows";
import type { NewsWrite } from "@/lib/trader/admin-console/collectors/news-persist";
import type {
  QuoteLatestRow,
  QuoteMinuteRow,
} from "@/lib/trader/admin-console/collectors/quote-rows";

export type JobRunWrite = {
  jobKey: string;
  startedAt: Date;
  finishedAt: Date;
  status: "succeeded" | "failed";
  processed: number;
  blocked: number;
  errorClass: string | null;
  errorMessage: string | null;
};

export type CollectorStore = {
  upsertQuotes(latest: readonly QuoteLatestRow[], minute: readonly QuoteMinuteRow[]): Promise<void>;
  hasFearGreed(): Promise<boolean>;
  upsertFearGreed(rows: readonly FearGreedRow[]): Promise<void>;
  findNews(
    dedupeKey: string,
  ): Promise<{ id: string; contentHash: string; currentVersion: number } | null>;
  applyNews(write: NewsWrite): Promise<void>;
  retain(now: Date): Promise<number>;
  collectValuations(now: Date): Promise<{ processed: number; blocked: number }>;
  recordJobRun(run: JobRunWrite): Promise<void>;
  recordDiagnostic(input: { service: string; error: unknown; jobKey?: string }): Promise<void>;
};

export async function runCollectedJob(
  store: CollectorStore,
  jobKey: string,
  work: () => Promise<number | { processed: number; blocked: number }>,
): Promise<void> {
  const startedAt = new Date();
  try {
    const result = await work();
    await safeTelemetry(() =>
      store.recordJobRun({
        jobKey,
        startedAt,
        finishedAt: new Date(),
        status: "succeeded",
        processed: typeof result === "number" ? result : result.processed,
        blocked: typeof result === "number" ? 0 : result.blocked,
        errorClass: null,
        errorMessage: null,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeTelemetry(() =>
      store.recordJobRun({
        jobKey,
        startedAt,
        finishedAt: new Date(),
        status: "failed",
        processed: 0,
        blocked: 0,
        errorClass: error instanceof Error ? error.name : "Error",
        errorMessage: redactDiagnosticText(message),
      }),
    );
    await safeTelemetry(() =>
      store.recordDiagnostic({ service: "admin-console-collector", error, jobKey }),
    );
    throw error;
  }
}

async function safeTelemetry(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch {
    // A telemetry write must not fail the collector or hide its result.
  }
}
