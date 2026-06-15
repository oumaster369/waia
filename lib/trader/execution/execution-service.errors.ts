import type { OrderExecutionMode } from "@/lib/trader/execution/types";

export class LiveExecutionNotSupportedError extends Error {
  readonly executionMode: OrderExecutionMode;

  constructor(executionMode: OrderExecutionMode) {
    super(`Live execution is not supported in S3: ${executionMode}`);
    this.name = "LiveExecutionNotSupportedError";
    this.executionMode = executionMode;
  }
}

export class UnsupportedExecutionModeError extends Error {
  readonly executionMode: string;

  constructor(executionMode: string) {
    super(`Unsupported execution mode: ${executionMode}`);
    this.name = "UnsupportedExecutionModeError";
    this.executionMode = executionMode;
  }
}
