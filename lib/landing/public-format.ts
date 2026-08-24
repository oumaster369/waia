const MICROS_PER_UNIT = 1_000_000n;

function groupWhole(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Exact, BigInt-safe public display. No floating-point money conversion. */
export function formatPublicMoney(micros: string | null, currency: string | null): string {
  if (micros === null || currency === null || !/^-?\d+$/.test(micros)) {
    return "Not yet published";
  }
  const value = BigInt(micros);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICROS_PER_UNIT;
  const fraction = (absolute % MICROS_PER_UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "−" : ""}${groupWhole(whole)}${fraction ? `.${fraction}` : ""} ${currency}`;
}

/** Exact display of the server-owned million-part share: 1,000,000 parts = 100%. */
export function formatPublicShare(partsPerMillion: string | null): string {
  if (partsPerMillion === null || !/^\d+$/.test(partsPerMillion)) {
    return "Not yet published";
  }
  const parts = BigInt(partsPerMillion);
  if (parts > 1_000_000n) return "Not yet published";
  const wholePercent = parts / 10_000n;
  const fraction = (parts % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return String(wholePercent) + (fraction ? "." + fraction : "") + "%";
}

export function formatPublicDateTime(value: string | null): string {
  if (!value) return "Not yet published";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not yet published";
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function formatPublicMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPublicRunway(endsAt: string | null, nowMs: number): string {
  if (!endsAt) return "Not yet published";
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(endMs)) return "Not yet published";
  const remainingMinutes = Math.max(0, Math.ceil((endMs - nowMs) / 60_000));
  if (remainingMinutes === 0) return "Runway elapsed";
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remainingMinutes % 60}m`;
  return `${remainingMinutes}m`;
}
