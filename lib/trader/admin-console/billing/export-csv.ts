export const EXPORT_ROW_LIMIT = 50_000;
export const EXPORT_TIME_LIMIT_MS = 60_000;

export function escapeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
  ];
}
