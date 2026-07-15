export function clampRiskMultiplierDownwardOnly(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function applyRiskMultiplierToQuantity(quantity: string, riskMultiplier: number): string {
  const clamped = clampRiskMultiplierDownwardOnly(riskMultiplier);
  if (clamped === 0) {
    return "0";
  }
  if (clamped === 1) {
    return quantity;
  }
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return String(numeric * clamped);
}
