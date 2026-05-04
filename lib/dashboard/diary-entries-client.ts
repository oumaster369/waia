import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type {
  DiaryEntriesListApiResponse,
  DiaryEntryAppendApiResponse,
  DiaryMemoryEntryDto,
} from "@/lib/dashboard/diary-memory-api.types";

export const DIARY_ENTRIES_API_PATH = "/api/dashboard/diary/entries";

export type ListDiaryEntriesOk = { kind: "ok"; entries: DiaryMemoryEntryDto[] };

export type ListDiaryEntriesErr = {
  kind: "err";
  status: number;
  displayMessage: string;
};

export type SubmitDiaryEntryOk = { kind: "ok"; body: DiaryEntryAppendApiResponse };

export type SubmitDiaryEntryErr = {
  kind: "err";
  status: number;
  code?: string;
  displayMessage: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseEntry(raw: unknown): DiaryMemoryEntryDto | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { id, body, createdAt } = raw;
  if (typeof id !== "string" || typeof body !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return { id, body, createdAt };
}

function narrowListSuccess(raw: unknown): DiaryEntriesListApiResponse | null {
  if (!isRecord(raw)) {
    return null;
  }
  const entriesRaw = raw.entries;
  if (!Array.isArray(entriesRaw)) {
    return null;
  }
  const entries: DiaryMemoryEntryDto[] = [];
  for (const item of entriesRaw) {
    const e = parseEntry(item);
    if (!e) {
      return null;
    }
    entries.push(e);
  }
  return { entries };
}

function narrowAppendSuccess(raw: unknown): DiaryEntryAppendApiResponse | null {
  if (!isRecord(raw)) {
    return null;
  }
  const entry = parseEntry(raw.entry);
  if (!entry || typeof raw.replayed !== "boolean") {
    return null;
  }
  return { entry, replayed: raw.replayed };
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
  if (message !== undefined && typeof message !== "string") {
    return null;
  }
  return { error: { code: error.code, message } };
}

export async function listDiaryEntriesClient(): Promise<ListDiaryEntriesOk | ListDiaryEntriesErr> {
  let response: Response;
  try {
    response = await fetch(DIARY_ENTRIES_API_PATH, {
      method: "GET",
      credentials: "include",
    });
  } catch {
    return {
      kind: "err",
      status: 0,
      displayMessage: "Could not load diary entries. Please try again.",
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      kind: "err",
      status: response.status,
      displayMessage:
        response.ok || response.status < 400
          ? "Could not read diary data. Please try again."
          : "Could not load diary entries. Please try again.",
    };
  }

  if (response.ok && response.status === 200) {
    const ok = narrowListSuccess(parsed);
    if (!ok) {
      return {
        kind: "err",
        status: response.status,
        displayMessage: "Could not read diary data. Please try again.",
      };
    }
    return { kind: "ok", entries: ok.entries };
  }

  const env = parseEnvelope(parsed);
  if (env?.error.code === "UNAUTHORIZED") {
    return {
      kind: "err",
      status: response.status,
      displayMessage: "Sign in required to load your diary.",
    };
  }
  if (env) {
    const msg = env.error.message;
    return {
      kind: "err",
      status: response.status,
      displayMessage:
        typeof msg === "string" && msg.trim().length > 0 ? msg : "Could not load diary entries. Please try again.",
    };
  }

  return {
    kind: "err",
    status: response.status,
    displayMessage: "Could not load diary entries. Please try again.",
  };
}

export async function submitDiaryEntryClient(params: {
  body: string;
  idempotencyKey: string;
}): Promise<SubmitDiaryEntryOk | SubmitDiaryEntryErr> {
  let response: Response;
  try {
    response = await fetch(DIARY_ENTRIES_API_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: params.body,
        idempotencyKey: params.idempotencyKey,
      }),
    });
  } catch {
    return {
      kind: "err",
      status: 0,
      displayMessage: "Could not save right now. Your text is still here—please try again.",
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      kind: "err",
      status: response.status,
      displayMessage:
        response.ok || response.status < 400
          ? "Could not read the server response. Please try again."
          : "Could not save right now. Your text is still here—please try again.",
    };
  }

  if (response.ok && response.status === 200) {
    const ok = narrowAppendSuccess(parsed);
    if (!ok) {
      return {
        kind: "err",
        status: response.status,
        displayMessage: "Could not read the server response. Please try again.",
      };
    }
    return { kind: "ok", body: ok };
  }

  const env = parseEnvelope(parsed);
  if (env) {
    const { code, message } = env.error;
    if (code === "UNAUTHORIZED") {
      return {
        kind: "err",
        status: response.status,
        code,
        displayMessage: "Sign in required to save diary entries.",
      };
    }
    return {
      kind: "err",
      status: response.status,
      code,
      displayMessage:
        typeof message === "string" && message.trim().length > 0
          ? message
          : "Could not save right now. Your text is still here—please try again.",
    };
  }

  return {
    kind: "err",
    status: response.status,
    displayMessage: "Could not save right now. Your text is still here—please try again.",
  };
}
