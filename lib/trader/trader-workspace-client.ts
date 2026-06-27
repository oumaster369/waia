import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type { CredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";
import type { BalanceSnapshotDto } from "@/lib/trader/balances/types";
import type { PositionSnapshotDto } from "@/lib/trader/positions/types";
import type { TradeHistorySnapshotDto } from "@/lib/trader/trade-history/types";

export type TraderClientOk<T> = { kind: "ok"; data: T };
export type TraderClientErr = {
  kind: "err";
  status: number;
  code?: string;
  displayMessage: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseEnvelope(raw: unknown): ApiErrorEnvelope | null {
  if (!isRecord(raw)) {
    return null;
  }
  const error = raw.error;
  if (!isRecord(error) || typeof error.code !== "string") {
    return null;
  }
  const message = error.message;
  return {
    error: {
      code: error.code,
      message: typeof message === "string" ? message : "Request failed.",
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errFromResponse(status: number, raw: unknown): TraderClientErr {
  const envelope = parseEnvelope(raw);
  return {
    kind: "err",
    status,
    code: envelope?.error.code,
    displayMessage: envelope?.error.message ?? "Request failed.",
  };
}

export type HtxConnectInput = {
  apiKey: string;
  apiSecret: string;
  accountLabel?: string;
};

export async function connectHtxClient(
  input: HtxConnectInput,
): Promise<TraderClientOk<CredentialMetadataDto> | TraderClientErr> {
  const response = await fetch("/api/trader/exchange-credentials/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue: "htx",
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      accountLabel: input.accountLabel,
    }),
    credentials: "same-origin",
  });
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  if (!isRecord(raw) || typeof raw.id !== "string") {
    return { kind: "err", status: 502, displayMessage: "Unexpected connect response." };
  }
  return { kind: "ok", data: raw as CredentialMetadataDto };
}

export async function listExchangeCredentialsClient(): Promise<
  TraderClientOk<CredentialMetadataDto[]> | TraderClientErr
> {
  const response = await fetch("/api/trader/exchange-credentials", {
    credentials: "same-origin",
  });
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  if (!isRecord(raw) || !Array.isArray(raw.credentials)) {
    return { kind: "err", status: 502, displayMessage: "Unexpected credentials list response." };
  }
  return { kind: "ok", data: raw.credentials as CredentialMetadataDto[] };
}

export async function syncBalancesClient(
  credentialId: string,
): Promise<TraderClientOk<BalanceSnapshotDto> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/exchange-credentials/${encodeURIComponent(credentialId)}/sync-balances`,
    { method: "POST", credentials: "same-origin" },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  return { kind: "ok", data: raw as BalanceSnapshotDto };
}

export async function listBalanceSnapshotsClient(
  credentialId: string,
): Promise<TraderClientOk<BalanceSnapshotDto[]> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/balance-snapshots?credentialId=${encodeURIComponent(credentialId)}&limit=5`,
    { credentials: "same-origin" },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  if (!isRecord(raw) || !Array.isArray(raw.snapshots)) {
    return { kind: "err", status: 502, displayMessage: "Unexpected balance snapshots response." };
  }
  return { kind: "ok", data: raw.snapshots as BalanceSnapshotDto[] };
}

export async function syncPositionsClient(
  credentialId: string,
): Promise<TraderClientOk<PositionSnapshotDto> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/exchange-credentials/${encodeURIComponent(credentialId)}/sync-positions`,
    { method: "POST", credentials: "same-origin" },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  return { kind: "ok", data: raw as PositionSnapshotDto };
}

export async function listPositionSnapshotsClient(
  credentialId: string,
): Promise<TraderClientOk<PositionSnapshotDto[]> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/position-snapshots?credentialId=${encodeURIComponent(credentialId)}&limit=5`,
    { credentials: "same-origin" },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  if (!isRecord(raw) || !Array.isArray(raw.snapshots)) {
    return { kind: "err", status: 502, displayMessage: "Unexpected position snapshots response." };
  }
  return { kind: "ok", data: raw.snapshots as PositionSnapshotDto[] };
}

export async function syncTradeHistoryClient(
  credentialId: string,
  symbol: string,
): Promise<TraderClientOk<TradeHistorySnapshotDto> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/exchange-credentials/${encodeURIComponent(credentialId)}/sync-trades`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
      credentials: "same-origin",
    },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  return { kind: "ok", data: raw as TradeHistorySnapshotDto };
}

export async function listTradeHistorySnapshotsClient(
  credentialId: string,
  symbol: string,
): Promise<TraderClientOk<TradeHistorySnapshotDto[]> | TraderClientErr> {
  const response = await fetch(
    `/api/trader/trade-history-snapshots?credentialId=${encodeURIComponent(credentialId)}&symbol=${encodeURIComponent(symbol)}&limit=5`,
    { credentials: "same-origin" },
  );
  const raw = await readJson(response);
  if (!response.ok) {
    return errFromResponse(response.status, raw);
  }
  if (!isRecord(raw) || !Array.isArray(raw.snapshots)) {
    return {
      kind: "err",
      status: 502,
      displayMessage: "Unexpected trade-history snapshots response.",
    };
  }
  return { kind: "ok", data: raw.snapshots as TradeHistorySnapshotDto[] };
}

/** Guard: reject responses that accidentally include secret fields. */
export function assertNoSecretsInPayload(raw: string): void {
  if (/apiSecret/i.test(raw) || /"api_secret"/i.test(raw)) {
    throw new Error("Secret field detected in trader client payload");
  }
}
