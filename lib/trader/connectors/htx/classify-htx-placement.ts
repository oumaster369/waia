/**
 * Classify one HTX placement HTTP result. This does not send a request and
 * does not look the order up. An unsafe numeric id is unknown: stringifying
 * it would invent an order identity.
 */
export class HtxPlacementRejectedError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(message: string, rawVenueObservation: Readonly<Record<string, unknown>>) {
    super(`[trader] HTX placement rejected: ${message}`);
    this.name = "HtxPlacementRejectedError";
    this.rawVenueObservation = Object.freeze({ ...rawVenueObservation });
  }
}

export type HtxPlacementClassification =
  | Readonly<{ kind: "accepted"; orderId: string }>
  | Readonly<{ kind: "rejected"; errCode: string }>
  | Readonly<{ kind: "unknown" }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeOrderId(data: unknown): string | null {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.length === 0 || trimmed.length > 64 || /\s/.test(trimmed)) return null;
    return trimmed;
  }
  if (typeof data === "number" && Number.isSafeInteger(data) && data > 0) {
    return String(data);
  }
  return null;
}

function deterministicReject(httpStatus: number, body: Record<string, unknown>): string | null {
  const clientError =
    httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;
  const success = httpStatus >= 200 && httpStatus < 300;
  if (!clientError && !success) return null;
  if (body.status !== "error") return null;
  if (typeof body["err-code"] !== "string" || body["err-code"].trim() === "") return null;
  if ("data" in body && body.data != null) return null;
  return body["err-code"].trim();
}

export function classifyHtxPlacementHttp(
  input: Readonly<{
    httpStatus: number;
    body: unknown;
  }>,
): HtxPlacementClassification {
  const body = asRecord(input.body);
  if (!body) return Object.freeze({ kind: "unknown" });
  if (input.httpStatus >= 200 && input.httpStatus < 300 && body.status === "ok") {
    const orderId = safeOrderId(body.data);
    if (orderId) return Object.freeze({ kind: "accepted", orderId });
    return Object.freeze({ kind: "unknown" });
  }
  const errCode = deterministicReject(input.httpStatus, body);
  if (errCode) return Object.freeze({ kind: "rejected", errCode });
  return Object.freeze({ kind: "unknown" });
}
