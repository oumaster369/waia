export const BANNED_DISCOVERY_FIELDS = [
  "pnl",
  "fitness",
  "reward",
  "profitable",
  "unprofitable",
  "winRate",
  "lossRate",
  "win_rate",
  "loss_rate",
  "realizedPnl",
  "tradePnl",
  "periodRealizedPnl",
  "profitFactor",
  "expectancy",
  "rMultiple",
  "r_multiple",
  "promotionOutcome",
  "promotion_outcome",
] as const;

export type BannedDiscoveryField = (typeof BANNED_DISCOVERY_FIELDS)[number];

export class NoReinforcementGuardError extends Error {
  readonly code = "NO_REINFORCEMENT_VIOLATION";

  constructor(message: string) {
    super(message);
    this.name = "NoReinforcementGuardError";
  }
}

function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectKeys(entry, `${prefix}[${index}]`));
  }
  if (typeof value === "object") {
    const keys: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.push(path);
      keys.push(...collectKeys(nested, path));
    }
    return keys;
  }
  return [];
}

function normalizeFieldName(field: string): string {
  return (
    field
      .replace(/\[\d+\]/g, "")
      .split(".")
      .pop() ?? field
  );
}

export function assertNoBannedFields(payload: unknown, context = "discovery payload"): void {
  const keys = collectKeys(payload);
  for (const key of keys) {
    const field = normalizeFieldName(key);
    for (const banned of BANNED_DISCOVERY_FIELDS) {
      if (field.toLowerCase() === banned.toLowerCase()) {
        throw new NoReinforcementGuardError(
          `[no-reinforcement-guard] banned field "${field}" in ${context}`,
        );
      }
    }
  }
}

export function isBannedDiscoveryField(field: string): field is BannedDiscoveryField {
  const normalized = field.toLowerCase();
  return BANNED_DISCOVERY_FIELDS.some((banned) => banned.toLowerCase() === normalized);
}
