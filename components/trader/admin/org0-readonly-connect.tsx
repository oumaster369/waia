"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { Org0ReadOnlyConnectResponse } from "@/lib/trader/credentials/org0-readonly-connect.types";

const ENDPOINT = "/api/trader/admin/org0-readonly-connect";
const NOMINATED_ACCOUNT_ID = "73737331";

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Войдите в систему, чтобы продолжить.",
  FORBIDDEN: "У вас нет доступа к этому подключению. Обратитесь к администратору Org0.",
  CREDENTIAL_CONFLICT: "Состояние ключа изменилось. Обновите страницу и проверьте подключение.",
  CREDENTIAL_VALIDATION_FAILED: "HTX не подтвердила нужный счёт и доступ только для чтения.",
  ORG0_UNAVAILABLE: "Подключение Org0 сейчас недоступно.",
  POSTGRES_REQUIRED: "Подключение Org0 сейчас недоступно.",
  MASTER_KEY_NOT_READY: "Хранилище ключей сейчас недоступно.",
  ADMIN_CONSOLE_ORIGIN_REJECTED: "Запрос не прошёл проверку источника. Обновите страницу и повторите попытку.",
};

type ApiError = { error?: { code?: string; message?: string } };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_METADATA_KEYS = new Set([
  "id",
  "venue",
  "exchangeAccountId",
  "apiKeyMasked",
  "status",
  "permissionMetadata",
  "createdAt",
  "updatedAt",
  "revokedAt",
]);

function parseConnectResponse(value: unknown): Org0ReadOnlyConnectResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "target" && key !== "credential")) return null;
  const target = record.target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) return null;
  const targetRecord = target as Record<string, unknown>;
  if (
    Object.keys(targetRecord).some(
      (key) =>
        !["organizationId", "venue", "exchangeAccountId", "marketType", "requiredPermission"].includes(key),
    ) ||
    typeof targetRecord.organizationId !== "string" ||
    !UUID_PATTERN.test(targetRecord.organizationId) ||
    targetRecord.venue !== "htx" ||
    targetRecord.exchangeAccountId !== NOMINATED_ACCOUNT_ID ||
    targetRecord.marketType !== "spot" ||
    targetRecord.requiredPermission !== "read"
  ) {
    return null;
  }

  const credential = record.credential;
  if (credential !== null) {
    if (typeof credential !== "object" || Array.isArray(credential)) return null;
    const row = credential as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !CREDENTIAL_METADATA_KEYS.has(key)) ||
      typeof row.id !== "string" ||
      !UUID_PATTERN.test(row.id) ||
      row.venue !== "htx" ||
      row.exchangeAccountId !== NOMINATED_ACCOUNT_ID ||
      (row.apiKeyMasked !== null && typeof row.apiKeyMasked !== "string") ||
      row.status !== "active" ||
      (row.permissionMetadata !== null &&
        (typeof row.permissionMetadata !== "object" || Array.isArray(row.permissionMetadata))) ||
      typeof row.createdAt !== "string" ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt)) ||
      row.revokedAt !== null
    ) {
      return null;
    }
  }

  return record as unknown as Org0ReadOnlyConnectResponse;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getErrorMessage(payload: unknown): string {
  const code =
    typeof payload === "object" && payload !== null && "error" in payload
      ? (payload as ApiError).error?.code
      : undefined;
  return (code && ERROR_MESSAGES[code]) || "Не удалось завершить подключение. Попробуйте позже.";
}

export function Org0ReadonlyConnect() {
  const apiKeyRef = React.useRef<HTMLInputElement>(null);
  const apiSecretRef = React.useRef<HTMLInputElement>(null);
  const postControllerRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "unavailable"; message: string }
    | { kind: "ready"; data: Org0ReadOnlyConnectResponse }
  >({ kind: "loading" });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      const payload = await readJson(response);
      if (signal?.aborted || !mountedRef.current) return;
      if (!response.ok) {
        setState({ kind: "unavailable", message: getErrorMessage(payload) });
        return;
      }
      const data = parseConnectResponse(payload);
      if (!data) {
        setState({
          kind: "unavailable",
          message: "Настройки подключения не совпадают с назначенным счётом. Обратитесь к администратору.",
        });
        return;
      }
      setState({ kind: "ready", data });
    } catch {
      if (!signal?.aborted) {
        setState({
          kind: "unavailable",
          message: "Не удалось проверить состояние подключения. Попробуйте обновить страницу.",
        });
      }
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    const start = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
      postControllerRef.current?.abort();
      mountedRef.current = false;
    };
  }, [load]);

  React.useEffect(() => {
    const apiKeyInput = apiKeyRef.current;
    const apiSecretInput = apiSecretRef.current;
    return () => {
      if (apiKeyInput) apiKeyInput.value = "";
      if (apiSecretInput) apiSecretInput.value = "";
    };
  }, [state.kind]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "ready" || submitting) return;
    const apiKey = apiKeyRef.current?.value.trim() ?? "";
    const apiSecret = apiSecretRef.current?.value.trim() ?? "";
    if (!apiKey || !apiSecret) {
      setError("Введите Access Key и Secret Key.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    postControllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          apiKey,
          apiSecret,
          expectedActiveCredentialId: state.data.credential?.id ?? null,
        }),
      });
      const payload = await readJson(response);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        setError(getErrorMessage(payload));
        if (response.status === 409) await load(controller.signal);
        return;
      }
      const data = parseConnectResponse(payload);
      // GET may legitimately have no active credential. A successful POST must
      // prove that the server returned the saved credential metadata.
      if (!data || !data.credential || data.target.organizationId !== state.data.target.organizationId) {
        setState({ kind: "unavailable", message: "Ответ сервера не прошёл проверку." });
        return;
      }
      setState({ kind: "ready", data });
      setNotice("Ключ сохранён для Org0. Сбор наблюдений настраивается отдельно.");
    } catch {
      if (mountedRef.current) {
        setError(
          timedOut
            ? "Ответ от сервера не получен вовремя: ключ мог сохраниться. Проверяем состояние подключения; не отправляйте ключ повторно, пока не проверите результат."
            : "Связь с сервером прервалась: ключ мог сохраниться. Проверяем состояние подключения; не отправляйте ключ повторно, пока не проверите результат.",
        );
        // A browser-side timeout or dropped response does not cancel server work.
        // Refresh the metadata-only state before the UI can offer another submission.
        await load();
      }
    } finally {
      window.clearTimeout(timeout);
      if (postControllerRef.current === controller) postControllerRef.current = null;
      if (apiKeyRef.current) apiKeyRef.current.value = "";
      if (apiSecretRef.current) apiSecretRef.current.value = "";
      if (mountedRef.current) setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div role="status" className="text-waia-fg-muted rounded-xl border border-waia-divider p-5 text-sm">
        Проверяем подключение…
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <WaiaSurface variant="raised" className="space-y-3 p-5">
        <h2 className="text-waia-fg text-sm font-semibold">Подключение недоступно</h2>
        <p role="alert" className="text-waia-fg-muted text-sm leading-6">
          {state.message}
        </p>
      </WaiaSurface>
    );
  }

  const currentCredential = state.data.credential;

  return (
    <WaiaSurface variant="raised" className="space-y-5 p-5 sm:p-6">
      <section className="space-y-2" aria-labelledby="org0-credential-status">
        <h2 id="org0-credential-status" className="text-waia-fg text-sm font-semibold">
          Счёт HTX {NOMINATED_ACCOUNT_ID}
        </h2>
        {currentCredential ? (
          <p className="text-waia-fg-muted text-sm">
            Сейчас подключён ключ {currentCredential.apiKeyMasked ?? "с маской, недоступной для показа"}.
            Новый ключ заменит его только после повторной проверки.
          </p>
        ) : (
          <p className="text-waia-fg-muted text-sm">Ключ для Org0 ещё не подключён.</p>
        )}
      </section>

      <div className="rounded-lg border border-waia-divider p-4 text-sm leading-6">
        <p className="font-medium">Нужен отдельный ключ только для чтения.</p>
        <p className="text-waia-fg-muted mt-1">
          Не включайте торговлю или перевод средств. Это действие не запускает сбор наблюдений и не
          включает торговлю.
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <label className="text-waia-fg grid gap-1.5 text-sm" htmlFor="org0-htx-api-key">
          HTX Access Key
          <Input
            ref={apiKeyRef}
            id="org0-htx-api-key"
            data-testid="org0-htx-api-key"
            maxLength={256}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="text-waia-fg grid gap-1.5 text-sm" htmlFor="org0-htx-api-secret">
          HTX Secret Key
          <Input
            ref={apiSecretRef}
            id="org0-htx-api-secret"
            data-testid="org0-htx-api-secret"
            maxLength={512}
            disabled={submitting}
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        {error ? (
          <p role="alert" className="text-waia-danger-fg text-sm leading-6">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-waia-fg-muted text-sm leading-6">
            {notice}
          </p>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Проверяем и сохраняем…" : currentCredential ? "Проверить и заменить ключ" : "Проверить и сохранить"}
        </Button>
      </form>
    </WaiaSurface>
  );
}
