"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { HistoricalV2ObservationDashboard } from "@/components/trader/historical-v2-observation-dashboard";
import { TraderSignOut } from "@/components/trader/trader-sign-out";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import {
  assertNoSecretsInPayload,
  connectHtxClient,
  listExchangeCredentialsClient,
  revokeExchangeCredentialClient,
} from "@/lib/trader/trader-workspace-client";
import { parseHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import type { CredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";

export function snapshotAgeText(iso: string | undefined, nowMs = Date.now()): string | null {
  if (!iso) return null;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp) || timestamp > nowMs) return null;
  const ageMinutes = Math.floor((nowMs - timestamp) / 60_000);
  if (ageMinutes < 1) return "Observed less than a minute ago";
  return `Observed ${ageMinutes} ${ageMinutes === 1 ? "minute" : "minutes"} ago`;
}

function PermissionExplainer() {
  return (
    <div
      data-testid="trader-permission-explainer"
      className="border-border bg-muted/20 text-muted-foreground rounded-lg border p-4 text-sm"
    >
        <p className="text-foreground font-medium">Как создать ключ HTX</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Откройте в HTX управление API и создайте ключ HMAC.</li>
        <li>
          Включите только разрешение <span className="text-foreground">Read</span>. Не включайте Withdraw.
          Разрешение Trade для этого кабинета не требуется.
        </li>
        <li>
          Оставьте список IP пустым, затем вставьте ниже Access Key и Secret Key. Секретный ключ
          отображается только один раз.
        </li>
        <li>
          После успешного подключения измените тот же ключ HTX и добавьте в список IP только{" "}
          <span className="text-foreground font-mono">84.32.9.146</span>.
        </li>
      </ol>
      <p className="mt-2 text-xs">
        Для HTX Spot используются только API key и secret, без passphrase. Это ваш личный аккаунт
        AI-TRADER; другие пользователи к нему не подключаются.
      </p>
    </div>
  );
}

function CredentialStatus({ credential }: { credential: CredentialMetadataDto }) {
  const metadata = parseHtxPermissionMetadata(credential.permissionMetadata);
  const warnings = metadata?.warnings ?? [];

  return (
    <div data-testid="trader-account-status" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {credential.status === "active" ? "HTX подключен в WAIA" : "Подключение HTX отозвано в WAIA"}
        </span>
        <span
          data-testid="trader-credential-status"
          className="bg-muted rounded-full px-2 py-0.5 text-xs capitalize"
        >
          {credential.status === "active" ? "Активен в WAIA" : "Отозван в WAIA"}
        </span>
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Аккаунт</dt>
          <dd data-testid="trader-credential-account-id">{credential.exchangeAccountId}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Ключ API</dt>
          <dd data-testid="trader-credential-masked-key">{credential.apiKeyMasked ?? "—"}</dd>
        </div>
        {metadata ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Разрешения</dt>
            <dd data-testid="trader-credential-scopes">{metadata.scopes.join(", ") || "—"}</dd>
          </div>
        ) : null}
      </dl>
      {warnings.length > 0 ? (
        <ul
          data-testid="trader-credential-warnings"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type CredentialAccountOption = Readonly<{ accountId: string; credential: CredentialMetadataDto }>;

function credentialAccountOptions(credentials: readonly CredentialMetadataDto[]): CredentialAccountOption[] {
  const byAccount = new Map<string, CredentialMetadataDto>();
  for (const credential of credentials) {
    const existing = byAccount.get(credential.exchangeAccountId);
    if (
      !existing ||
      (credential.status === "active" && existing.status !== "active") ||
      (credential.status === existing.status && credential.updatedAt > existing.updatedAt)
    ) {
      byAccount.set(credential.exchangeAccountId, credential);
    }
  }
  return [...byAccount.entries()]
    .map(([accountId, credential]) => ({ accountId, credential }))
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
}

function credentialRequestError(code: string | undefined, status: number): string {
  if (status === 0) return "Не удалось подтвердить результат запроса. Проверьте состояние подключения перед повторной отправкой ключа.";
  switch (code) {
    case "CREDENTIAL_CONFLICT": return "Состояние аккаунта изменилось. Обновите список и повторите действие.";
    case "CREDENTIAL_NOT_FOUND": return "Подключение не найдено. Обновите список аккаунтов.";
    case "CREDENTIAL_VALIDATION_FAILED": return "HTX не подтвердил эти ключи. Проверьте их разрешения и попробуйте снова.";
    case "UNAUTHORIZED": return "Войдите в аккаунт, чтобы управлять подключением HTX.";
    case "FORBIDDEN": return "У этого аккаунта нет доступа к AI-TRADER.";
    case "CSRF_INVALID": return "Запрос отклонён. Обновите страницу и повторите действие.";
    case "MASTER_KEY_NOT_READY": return "Сохранение подключений временно недоступно. Попробуйте позже.";
    default: return "Не удалось завершить запрос. Проверьте состояние подключения перед повторной отправкой ключа.";
  }
}

function ExchangeTraderWorkspace() {
  const [credentials, setCredentials] = React.useState<CredentialMetadataDto[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState("");
  const [addingNewAccount, setAddingNewAccount] = React.useState(false);
  const [editingReplacement, setEditingReplacement] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [accountLabel, setAccountLabel] = React.useState("");
  const mutationBusy = connecting || disconnecting;
  const scope = React.useRef(0);
  const selectedAccountIdRef = React.useRef("");
  const credentialIdsRef = React.useRef(new Set<string>());
  const pending = React.useRef(new Map<string, object>());
  const asyncError =
    "Запрос не завершился. Проверьте состояние подключения перед повторной отправкой ключа.";

  const accountOptions = credentialAccountOptions(credentials);
  const selectedAccount = accountOptions.find((account) => account.accountId === selectedAccountId);
  const selectedCredential = selectedAccount?.credential;

  const loadWorkspace = React.useCallback(async (clearError = true, preferNewActive = false): Promise<CredentialMetadataDto[] | null> => {
    const generation = ++scope.current;
    pending.current.clear();
    setConnecting(false);
    setDisconnecting(false);
    setLoading(true);
    if (clearError) setErrorMessage(null);
    try {
      const result = await listExchangeCredentialsClient();
      if (scope.current !== generation) return null;
      if (result.kind === "err") {
        setErrorMessage(credentialRequestError(result.code, result.status));
        setCredentials([]);
        return null;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setCredentials(result.data);
      const options = credentialAccountOptions(result.data);
      const previousSelection = selectedAccountIdRef.current;
      const newlyActive = preferNewActive
        ? result.data.filter((credential) => credential.status === "active" && !credentialIdsRef.current.has(credential.id))
        : [];
      const retained = (newlyActive.length === 1 ? newlyActive[0]!.exchangeAccountId : "") || (options.some((account) => account.accountId === previousSelection)
        ? previousSelection
        : !previousSelection && options.length === 1 ? options[0]!.accountId : "");
      const selectionRequired = preferNewActive && newlyActive.length > 1;
      const nextSelection = selectionRequired ? "" : retained;
      if (preferNewActive) {
        setAddingNewAccount(false);
        setEditingReplacement(false);
      }
      credentialIdsRef.current = new Set(result.data.map((credential) => credential.id));
      selectedAccountIdRef.current = nextSelection;
      setSelectedAccountId(nextSelection);
      return result.data;
    } catch {
      if (scope.current === generation) setErrorMessage(asyncError);
      return null;
    } finally {
      if (scope.current === generation) setLoading(false);
    }
  }, []);

  const retireScope = React.useCallback(() => {
    ++scope.current;
  }, []);

  const selectAccount = (accountId: string) => {
    ++scope.current;
    selectedAccountIdRef.current = accountId;
    setSelectedAccountId(accountId);
    setAddingNewAccount(false);
    setEditingReplacement(false);
    setConnecting(false);
    setDisconnecting(false);
    setConfirmDisconnect(false);
    setApiKey("");
    setApiSecret("");
    setAccountLabel("");
    setErrorMessage(null);
  };
  React.useEffect(() => {
    void (async () => {
      await loadWorkspace();
    })();
    return retireScope;
  }, [loadWorkspace, retireScope]);

  const runRequest = (
    name: string,
    setPending: (value: boolean) => void,
    work: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (pending.current.size > 0 || pending.current.has(name)) return;
    const owner = {};
    pending.current.set(name, owner);
    const generation = scope.current;
    const isCurrent = () => scope.current === generation;
    setPending(true);
    setErrorMessage(null);
    void (async () => {
      try {
        await work(isCurrent);
      } catch {
        if (isCurrent()) setErrorMessage(asyncError);
      } finally {
        if (pending.current.get(name) === owner) {
          pending.current.delete(name);
          if (isCurrent()) setPending(false);
        }
      }
    })();
  };

  const handleConnect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();
    if (!trimmedKey || !trimmedSecret) {
      setErrorMessage("Введите Access Key и Secret Key.");
      return;
    }
    const targetAccountId = selectedCredential?.exchangeAccountId ?? null;
    const replacementCredentialId = selectedCredential?.status === "active" ? selectedCredential.id : undefined;
    runRequest(`connect:${targetAccountId ?? "new"}`, setConnecting, async (isCurrent) => {
      const result = await connectHtxClient({
        apiKey: trimmedKey,
        apiSecret: trimmedSecret,
        accountLabel: accountLabel.trim() || undefined,
        replacementCredentialId,
      });
      if (!isCurrent()) return;
      if (result.kind === "err") {
        const displayMessage = credentialRequestError(result.code, result.status);
        setApiKey("");
        setApiSecret("");
        setAccountLabel("");
        const refresh = loadWorkspace(false, true);
        const refreshGeneration = scope.current;
        await refresh;
        if (scope.current === refreshGeneration) setErrorMessage(displayMessage);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setApiKey("");
      setApiSecret("");
      setAccountLabel("");
      selectedAccountIdRef.current = result.data.exchangeAccountId;
      setSelectedAccountId(result.data.exchangeAccountId);
      setAddingNewAccount(false);
      setEditingReplacement(false);
      setConnecting(false);
      await loadWorkspace();
    });
  };

  const cancelConnect = () => {
    setApiKey("");
    setApiSecret("");
    setAccountLabel("");
    setEditingReplacement(false);
    if (addingNewAccount) {
      setAddingNewAccount(false);
      selectAccount("");
    }
  };

  const handleDisconnect = () => {
    if (!selectedCredential || selectedCredential.status !== "active") return;
    const credentialId = selectedCredential.id;
    runRequest(`revoke:${credentialId}`, setDisconnecting, async (isCurrent) => {
      const result = await revokeExchangeCredentialClient(credentialId);
      if (!isCurrent()) return;
      if (result.kind === "err") {
        const displayMessage = credentialRequestError(result.code, result.status);
        const refresh = loadWorkspace(false);
        const refreshGeneration = scope.current;
        const refreshedCredentials = await refresh;
        if (scope.current !== refreshGeneration) return;
        const stillActive = refreshedCredentials?.some((credential) =>
          credential.exchangeAccountId === selectedAccountIdRef.current && credential.status === "active",
        );
        if (refreshedCredentials && !stillActive) setConfirmDisconnect(false);
        setErrorMessage(displayMessage);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setConfirmDisconnect(false);
      await loadWorkspace();
    });
  };

  return (
    <div
      data-testid="trader-workspace"
      className="bg-background flex min-h-screen flex-col px-6 py-10 md:px-10"
    >
      <header className="border-border mb-10 border-b pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA · Trader</p>
          <span className="border-border bg-muted/20 rounded-full border px-3 py-1 text-xs">
            User account
          </span>
          <TraderSignOut />
        </div>
        <h1
          data-testid="trader-workspace-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          AI-TRADER
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Live read-only HTX account. This workspace cannot enable live trading or change capital
          authority.
        </p>
      </header>
      {errorMessage ? (
        <p
          role="alert"
          data-testid="trader-error-message"
          className="border-destructive/30 bg-destructive/5 text-destructive mb-6 rounded-lg border px-4 py-3 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground text-sm">Загрузка аккаунтов…</p>
      ) : (
        <div className="space-y-6">
          {accountOptions.length > 0 ? (
            <section aria-labelledby="trader-account-heading" className="space-y-4">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Аккаунты</p>
                <h2 id="trader-account-heading" className="mt-1 text-xl font-semibold">
                  Подключения HTX
                </h2>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <label htmlFor="trader-account-select" className="text-sm font-medium">
                    Выберите аккаунт
                  </label>
                  <select
                    id="trader-account-select"
                    data-testid="trader-account-select"
                    value={selectedAccountId}
                    disabled={mutationBusy}
                    onChange={(event) => selectAccount(event.target.value)}
                    className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="">Выберите аккаунт</option>
                    {accountOptions.map(({ accountId, credential }) => (
                      <option key={accountId} value={accountId}>
                        HTX {accountId} · {credential.status === "active" ? "Активен в WAIA" : "Отозван в WAIA"}
                      </option>
                    ))}
                  </select>
                </div>
                {!addingNewAccount ? (
                  <Button type="button" variant="outline" disabled={mutationBusy} onClick={() => {
                    selectAccount("");
                    setAddingNewAccount(true);
                  }}>
                    Подключить другой аккаунт
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {accountOptions.length > 0 && !selectedCredential && !addingNewAccount ? (
            <div className="border-border bg-muted/10 rounded-lg border p-4 text-sm" data-testid="trader-account-selection-prompt">
              Выберите аккаунт, чтобы просмотреть его статус и историю, или подключите другой.
            </div>
          ) : null}

          {selectedCredential ? (
            <section aria-label="Выбранный аккаунт HTX" className="space-y-4">
              <WaiaSurface variant="elevated" className="p-6">
                <CredentialStatus credential={selectedCredential} />
                {selectedCredential.status === "active" ? (
                  <div className="mt-4">
                    {!editingReplacement && !confirmDisconnect ? (
                      <Button type="button" variant="outline" disabled={mutationBusy} onClick={() => setEditingReplacement(true)} data-testid="trader-replace-button">
                        Заменить подключение
                      </Button>
                    ) : null}
                    {!confirmDisconnect ? (
                      <Button type="button" variant="outline" disabled={mutationBusy}
                        onClick={() => setConfirmDisconnect(true)} data-testid="trader-disconnect-button">
                        Отключить подключение
                      </Button>
                    ) : (
                      <div className="border-border bg-muted/10 rounded-lg border p-4" role="group" aria-label="Подтвердить отключение">
                        <p className="text-sm">Будет отозвана только запись подключения в WAIA. Сам ключ HTX и внешний исполнитель не изменятся; история сохранится.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" variant="destructive" disabled={disconnecting}
                            onClick={handleDisconnect} data-testid="trader-disconnect-confirm">
                            {disconnecting ? "Отключение…" : "Подтвердить отключение"}
                          </Button>
                          <Button type="button" variant="outline" disabled={mutationBusy}
                            onClick={() => setConfirmDisconnect(false)}>Отмена</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </WaiaSurface>
              {selectedCredential.status === "active" ? (
                <ConnectedAccountObservationPanel
                  key={`${selectedCredential.id}:${selectedCredential.status}:${selectedCredential.updatedAt}`}
                  target={{ credentialId: selectedCredential.id, exchangeAccountId: selectedCredential.exchangeAccountId }}
                />
              ) : null}
              <p className="text-muted-foreground text-sm" data-testid="trader-unpublished-note">
                Стратегия, прогноз, новости и месячный отчёт пока не опубликованы в этом кабинете.
                Выводы не строятся.
              </p>
              <aside className="border-border bg-muted/10 rounded-lg border p-4 text-sm" data-testid="trader-authority-boundary">
                <p className="font-medium">Только наблюдение</p>
                <p className="text-muted-foreground mt-1">
                  Кабинет предназначен только для наблюдения. Включение live-режима, аварийные
                  переключатели, публикация стратегий, административные функции и управление
                  капиталом здесь недоступны.
                </p>
              </aside>
            </section>
          ) : null}

          {(accountOptions.length === 0 || addingNewAccount || selectedCredential?.status === "revoked" || editingReplacement) ? (
            <div className="mx-auto w-full max-w-lg space-y-6">
              <WaiaSurface variant="elevated" className="p-6" data-testid="trader-connect-section">
                <h2 className="text-lg font-medium">
                  Подключить HTX
                </h2>
                {selectedCredential?.status === "active" ? (
                  <p className="mt-2 text-sm font-medium">Это заменит подключение в WAIA для выбранного аккаунта, а не добавит отдельный ключ наблюдения. Сам ключ HTX и внешний исполнитель не изменятся; история сохранится.</p>
                ) : selectedCredential ? (
                  <p className="text-muted-foreground mt-1 text-sm">Предыдущая запись подключения отозвана в WAIA. Введённый ключ может относиться к другому аккаунту HTX; после ответа будет выбран аккаунт из результата. История сохранится.</p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-sm">
                    Создайте ключ HTX HMAC только с разрешением чтения. Не включайте Withdraw.
                    Вставьте ниже Access Key и Secret Key.
                  </p>
                )}
                <form className="mt-6 space-y-4" onSubmit={handleConnect} data-testid="trader-connect-form">
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-api-key">HTX Access Key</label>
                    <Input id="trader-api-key" data-testid="trader-api-key" className="mt-1"
                      value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-api-secret">HTX Secret Key</label>
                    <Input id="trader-api-secret" data-testid="trader-api-secret" type="password" className="mt-1"
                      value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-account-label">Название аккаунта (необязательно)</label>
                    <Input id="trader-account-label" data-testid="trader-account-label" className="mt-1"
                      value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} />
                  </div>
                  <PermissionExplainer />
                  <Button type="submit" disabled={mutationBusy} data-testid="trader-connect-submit" className="w-full">
                    {connecting ? "Подключение…" : selectedCredential?.status === "active"
                      ? "Заменить подключение"
                      : "Подключить HTX"}
                  </Button>
                  {selectedCredential?.status === "active" || addingNewAccount ? (
                    <Button type="button" variant="outline" disabled={mutationBusy} onClick={cancelConnect}>
                      Отмена
                    </Button>
                  ) : null}
                </form>
              </WaiaSurface>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function HistoricalTraderWorkspace(): React.ReactNode {
  const params = useSearchParams();
  const runId = params.get("campaign_run_id")?.trim() ?? "";
  const accountId = params.get("account_id")?.trim() ?? "";
  return (
    <div
      data-testid="trader-workspace"
      className="bg-background flex min-h-screen flex-col px-6 py-10 md:px-10"
    >
      <header className="border-border mb-10 border-b pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA · Trader</p>
          <span className="border-border bg-muted/20 rounded-full border px-3 py-1 text-xs">
            Historical simulation workspace
          </span>
          <TraderSignOut />
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">AI-TRADER</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Observe your tenant-scoped historical simulation automatically. No exchange credentials,
          real balances, live trading, or capital controls are loaded.
        </p>
      </header>
      {accountId ? (
        <HistoricalV2ObservationDashboard
          runId={runId}
          accountId={accountId}
          endpoint={`/api/trader/historical-v2/stream?run_id=${encodeURIComponent(runId)}&account_id=${encodeURIComponent(accountId)}`}
        />
      ) : (
        <WaiaSurface variant="raised" className="p-5">
          <p className="font-medium">Account identity required</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Open the account-scoped historical observation link containing both campaign_run_id and
            account_id.
          </p>
        </WaiaSurface>
      )}
    </div>
  );
}

/** Historical mode is a separate component boundary so exchange effects never mount. */
export function TraderWorkspace(): React.ReactNode {
  const runId = useSearchParams().get("campaign_run_id")?.trim() ?? "";
  return runId ? <HistoricalTraderWorkspace key={runId} /> : <ExchangeTraderWorkspace />;
}
