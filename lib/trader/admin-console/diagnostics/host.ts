export type HostDiagnosticRecord = (input: { service: string; error: unknown }) => Promise<void>;

export type HostEventTarget = {
  on(event: "uncaughtException" | "unhandledRejection", listener: (error: unknown) => void): void;
  off(event: "uncaughtException" | "unhandledRejection", listener: (error: unknown) => void): void;
};

export function installHostDiagnostics(input: {
  service: string;
  record: HostDiagnosticRecord;
  target?: HostEventTarget;
  exitOnUncaught?: boolean;
  exit?: (code: number) => void;
}): () => void {
  const target = input.target ?? process;
  const listen = (kind: "uncaughtException" | "unhandledRejection") => (error: unknown) => {
    void input
      .record({ service: input.service, error })
      .catch(() => undefined)
      .finally(() => {
        if (kind === "uncaughtException" && input.exitOnUncaught) {
          (input.exit ?? ((code: number) => process.exit(code)))(1);
        }
      });
  };
  const onException = listen("uncaughtException");
  const onRejection = listen("unhandledRejection");
  target.on("uncaughtException", onException);
  target.on("unhandledRejection", onRejection);
  return () => {
    target.off("uncaughtException", onException);
    target.off("unhandledRejection", onRejection);
  };
}

export async function reportHostFailure(
  record: HostDiagnosticRecord,
  service: string,
  error: unknown,
): Promise<void> {
  try {
    await record({ service, error });
  } catch {
    // The host keeps its own exit path when the diagnostic write fails.
  }
}
