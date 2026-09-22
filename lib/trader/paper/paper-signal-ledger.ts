import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type PaperSignalLedgerRecord = Readonly<{
  cycleId: string;
  strategySignalId: string;
  riskVerdict: "NO_TRADE" | "EXECUTION_BOUND" | "NOT_RECORDED";
  reasonCodes: readonly string[];
}>;

export type PaperSignalLedger = Readonly<{
  append(record: PaperSignalLedgerRecord): Promise<void>;
  list(): Promise<readonly PaperSignalLedgerRecord[]>;
}>;

export function encodePaperSignalSseEvent(record: PaperSignalLedgerRecord): string {
  return `event: paper_signal\ndata: ${JSON.stringify(record)}\n\n`;
}

export function createJsonlPaperSignalLedger(filePath: string): PaperSignalLedger {
  return {
    async append(record) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
    },
    async list() {
      let raw = "";
      try {
        raw = readFileSync(filePath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      }
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as PaperSignalLedgerRecord);
    },
  };
}

export function createMemoryPaperSignalLedger(): PaperSignalLedger {
  const records: PaperSignalLedgerRecord[] = [];
  return {
    async append(record) {
      records.push(
        Object.freeze({ ...record, reasonCodes: Object.freeze([...record.reasonCodes]) }),
      );
    },
    async list() {
      return records;
    },
  };
}
