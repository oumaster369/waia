export function guardianOrderKeys(
  cycleId: string,
  positionLotId: string,
): {
  clientOrderId: string;
  idempotencyKey: string;
} {
  return {
    clientOrderId: `client-guardian-${cycleId}-${positionLotId}`,
    idempotencyKey: `idem-guardian-${cycleId}-${positionLotId}`,
  };
}
