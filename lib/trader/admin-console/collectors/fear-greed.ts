export function fearGreedValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("FEAR_GREED_RANGE");
  }
  return value;
}
