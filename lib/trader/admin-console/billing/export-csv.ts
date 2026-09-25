export const EXPORT_ROW_LIMIT = 50_000;
export const EXPORT_TIME_LIMIT_MS = 60_000;

export function escapeCsvCell(value: string): string {
  const prefixed = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/^[=+\-@\t\r]/.test(value) || /[",\n\r]/.test(prefixed)) {
    return `"${prefixed.replaceAll('"', '""')}"`;
  }
  return prefixed;
}

export function assertExportWithinLimits(rows: number, elapsedMs: number): void {
  if (rows > EXPORT_ROW_LIMIT || elapsedMs > EXPORT_TIME_LIMIT_MS) {
    throw new Error("EXPORT_LIMIT");
  }
}

export function buildAdminCsv(input: {
  generatedAt: string;
  financeRevision: string;
  filters: string;
  currency: string;
  scope: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  elapsedMs: number;
}): string {
  assertExportWithinLimits(input.rows.length, input.elapsedMs);
  const header = input.headers.map((cell) => escapeCsvCell(cell)).join(",");
  const body = input.rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(","));
  return [...exportPreamble(input), header, ...body].join("\n");
}

export function exportPreamble(input: {
  generatedAt: string;
  financeRevision: string;
  filters: string;
  currency: string;
  scope: string;
}): string[] {
  return [
    `# generatedAt=${input.generatedAt}`,
    `# financeRevision=${input.financeRevision}`,
    `# filters=${input.filters}`,
    `# currency=${input.currency}`,
    `# scope=${input.scope}`,
    "# emptyCell=null_or_unavailable; not_zero; see state/reason columns",
    "# formulaSafety=leading = + - @ tab CR are prefixed with apostrophe, including negative decimals",
  ];
}

/** Validate the bounded snapshot before sending any bytes, then encode rows on
 * demand. Limits never silently truncate an attachment. The database snapshot
 * has already completed; abort during its read is handled by the repository. */
export function streamAdminCsv(
  input: Parameters<typeof buildAdminCsv>[0],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  assertExportWithinLimits(input.rows.length, input.elapsedMs);
  if (signal.aborted) throw new Error("EXPORT_ABORTED");
  const encoder = new TextEncoder();
  const preamble = [...exportPreamble(input), input.headers.map(escapeCsvCell).join(",")];
  let offset = -preamble.length;
  let first = true;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (signal.aborted) {
          controller.error(new Error("EXPORT_ABORTED"));
          return;
        }
        if (offset >= input.rows.length) {
          controller.close();
          return;
        }
        const lines: string[] = [];
        for (let count = 0; count < 64 && offset < input.rows.length; count += 1, offset += 1) {
          lines.push(
            offset < 0
              ? preamble[offset + preamble.length]!
              : input.rows[offset]!.map(escapeCsvCell).join(","),
          );
        }
        controller.enqueue(encoder.encode((first ? "" : "\n") + lines.join("\n")));
        first = false;
      },
    },
    { highWaterMark: 0 },
  );
}
