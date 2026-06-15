export class OrderVersionConflictError extends Error {
  readonly orderId: string;
  readonly expectedStateVersion: number;

  constructor(orderId: string, expectedStateVersion: number) {
    super(
      `Order version conflict for order ${orderId} (expected state_version ${expectedStateVersion})`,
    );
    this.name = "OrderVersionConflictError";
    this.orderId = orderId;
    this.expectedStateVersion = expectedStateVersion;
  }
}

export class DuplicateOrderError extends Error {
  readonly clientOrderId?: string;
  readonly idempotencyKey?: string;

  constructor(message: string, keys?: { clientOrderId?: string; idempotencyKey?: string }) {
    super(message);
    this.name = "DuplicateOrderError";
    this.clientOrderId = keys?.clientOrderId;
    this.idempotencyKey = keys?.idempotencyKey;
  }
}

export class OrderNotFoundError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
    this.orderId = orderId;
  }
}

export class FillConflictError extends Error {
  readonly orderId: string;
  readonly exchangeTradeId: string;

  constructor(orderId: string, exchangeTradeId: string) {
    super(`Fill data mismatch for order ${orderId} and exchange trade id ${exchangeTradeId}`);
    this.name = "FillConflictError";
    this.orderId = orderId;
    this.exchangeTradeId = exchangeTradeId;
  }
}
