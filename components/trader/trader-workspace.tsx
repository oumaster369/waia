"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
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
        <p className="text-foreground font-medium">How to create an HTX key</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Open API management in HTX and create an HMAC key.</li>
        <li>
          The <span className="text-foreground">Read</span> permission is enough to display the account;
          a key with Read and Trade can also be connected. Do not enable Withdraw: WAIA uses the key
          only for observation and does not perform trades.
        </li>
        <li>
          Leave the IP list empty, then enter the Access Key and Secret Key below. The Secret Key
          is shown only once.
        </li>
        <li>
          After connecting successfully, edit the same HTX key and add only this address to its IP list:{" "}
          <span className="text-foreground font-mono">84.32.9.146</span>.
        </li>
      </ol>
      <p className="mt-2 text-xs">
        HTX Spot uses only the API key and secret, with no passphrase. This is your personal
        AI-TRADER account; other users cannot connect to it.
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
          {credential.status === "active" ? "HTX connected in WAIA" : "HTX connection revoked in WAIA"}
        </span>
        <span
          data-testid="trader-credential-status"
          className="bg-muted rounded-full px-2 py-0.5 text-xs capitalize"
        >
          {credential.status === "active" ? "Active in WAIA" : "Revoked in WAIA"}
        </span>
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Account</dt>
          <dd data-testid="trader-credential-account-id">{credential.exchangeAccountId}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">API key</dt>
          <dd data-testid="trader-credential-masked-key">{credential.apiKeyMasked ?? "—"}</dd>
        </div>
        {metadata ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Permissions</dt>
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
  if (status === 0) return "The request result could not be confirmed. Check the connection status before submitting the key again.";
  switch (code) {
    case "CREDENTIAL_CONFLICT": return "The account state changed. Refresh the list and try again.";
    case "CREDENTIAL_NOT_FOUND": return "Connection not found. Refresh the account list.";
    case "CREDENTIAL_VALIDATION_FAILED": return "HTX did not validate these keys. Check their permissions and try again.";
    case "UNAUTHORIZED": return "Sign in to manage the HTX connection.";
    case "FORBIDDEN": return "This account has no access to AI-TRADER.";
    case "CSRF_INVALID": return "Request rejected. Refresh the page and try again.";
    case "MASTER_KEY_NOT_READY": return "Connection storage is temporarily unavailable. Try again later.";
    default: return "The request could not be completed. Check the connection status before submitting the key again.";
  }
}

type WorkspaceAccess = "loading" | "allowed" | "unauthenticated" | "forbidden" | "unavailable";

function ExchangeTraderWorkspace({ signInHref }: { signInHref: string }) {
  const [credentials, setCredentials] = React.useState<CredentialMetadataDto[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState("");
  const [addingNewAccount, setAddingNewAccount] = React.useState(false);
  const [editingReplacement, setEditingReplacement] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [access, setAccess] = React.useState<WorkspaceAccess>("loading");
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [confirmDisconnectCredentialId, setConfirmDisconnectCredentialId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [accountLabel, setAccountLabel] = React.useState("");
  const mutationBusy = connecting || disconnecting;
  const scope = React.useRef(0);
  const selectedAccountIdRef = React.useRef("");
  const pending = React.useRef(new Map<string, object>());
  const asyncError =
    "The request did not complete. Check the connection status before submitting the key again.";

  const clearCredentialInputs = React.useCallback(() => {
    setApiKey("");
    setApiSecret("");
    setAccountLabel("");
    selectedAccountIdRef.current = "";
    setSelectedAccountId("");
    setAddingNewAccount(false);
    setEditingReplacement(false);
    setConfirmDisconnectCredentialId(null);
  }, []);

  const loseAccess = React.useCallback((next: "unauthenticated" | "forbidden") => {
    setAccess(next);
    setCredentials([]);
    clearCredentialInputs();
    setErrorMessage(null);
    setConnecting(false);
    setDisconnecting(false);
  }, [clearCredentialInputs]);

  const accountOptions = credentialAccountOptions(credentials);
  const selectedAccount = accountOptions.find((account) => account.accountId === selectedAccountId);
  const selectedCredential = selectedAccount?.credential;
  const confirmDisconnect = !!selectedCredential && confirmDisconnectCredentialId === selectedCredential.id;

  const loadWorkspace = React.useCallback(async (
    clearError = true,
    ambiguousConnectRecovery?: { requestedAccountId: string | null },
  ): Promise<CredentialMetadataDto[] | null> => {
    const generation = ++scope.current;
    pending.current.clear();
    setConnecting(false);
    setDisconnecting(false);
    setLoading(true);
    if (clearError) setErrorMessage(null);
    setAccess("loading");
    try {
      const result = await listExchangeCredentialsClient();
      if (scope.current !== generation) return null;
      if (result.kind === "err") {
        if (result.status === 401) {
          loseAccess("unauthenticated");
          return null;
        }
        if (result.status === 403) {
          loseAccess("forbidden");
          return null;
        }
        setAccess("unavailable");
        clearCredentialInputs();
        setErrorMessage(credentialRequestError(result.code, result.status));
        setCredentials([]);
        return null;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setAccess("allowed");
      setCredentials(result.data);
      const options = credentialAccountOptions(result.data);
      const previousSelection = selectedAccountIdRef.current;
      const retained = options.some((account) => account.accountId === previousSelection)
        ? previousSelection
        : !previousSelection && options.length === 1 ? options[0]!.accountId : "";
      const nextSelection = ambiguousConnectRecovery
        ? ambiguousConnectRecovery.requestedAccountId && options.some((account) => account.accountId === ambiguousConnectRecovery.requestedAccountId)
          ? ambiguousConnectRecovery.requestedAccountId
          : ""
        : retained;
      if (ambiguousConnectRecovery) {
        setAddingNewAccount(false);
        setEditingReplacement(false);
        setConfirmDisconnectCredentialId(null);
      }
      selectedAccountIdRef.current = nextSelection;
      setSelectedAccountId(nextSelection);
      return result.data;
    } catch {
      if (scope.current === generation) {
        setAccess("unavailable");
        setCredentials([]);
        clearCredentialInputs();
        setErrorMessage(asyncError);
      }
      return null;
    } finally {
      if (scope.current === generation) setLoading(false);
    }
  }, [asyncError, clearCredentialInputs, loseAccess]);

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
    setConfirmDisconnectCredentialId(null);
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
      setErrorMessage("Enter the Access Key and Secret Key.");
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
        if (result.status === 401 || (result.status === 403 && result.code === "FORBIDDEN")) {
          loseAccess(result.status === 401 ? "unauthenticated" : "forbidden");
          return;
        }
        const displayMessage = credentialRequestError(result.code, result.status);
        setApiKey("");
        setApiSecret("");
        setAccountLabel("");
        const refresh = loadWorkspace(false, { requestedAccountId: replacementCredentialId ? targetAccountId : null });
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
      setConfirmDisconnectCredentialId(null);
      setConnecting(false);
      await loadWorkspace();
    });
  };

  const cancelConnect = () => {
    setApiKey("");
    setApiSecret("");
    setAccountLabel("");
    setEditingReplacement(false);
    setConfirmDisconnectCredentialId(null);
    if (addingNewAccount) {
      setAddingNewAccount(false);
      selectAccount("");
    }
  };

  const handleDisconnect = () => {
    if (!selectedCredential || selectedCredential.status !== "active" || selectedCredential.id !== confirmDisconnectCredentialId) return;
    const credentialId = selectedCredential.id;
    runRequest(`revoke:${credentialId}`, setDisconnecting, async (isCurrent) => {
      const result = await revokeExchangeCredentialClient(credentialId);
      if (!isCurrent()) return;
      if (result.kind === "err") {
        if (result.status === 401 || (result.status === 403 && result.code === "FORBIDDEN")) {
          loseAccess(result.status === 401 ? "unauthenticated" : "forbidden");
          return;
        }
        const displayMessage = credentialRequestError(result.code, result.status);
        const refresh = loadWorkspace(false);
        const refreshGeneration = scope.current;
        const refreshedCredentials = await refresh;
        if (scope.current !== refreshGeneration) return;
        const stillActive = refreshedCredentials?.some((credential) =>
          credential.id === credentialId && credential.status === "active",
        );
        if (refreshedCredentials && !stillActive) setConfirmDisconnectCredentialId(null);
        setErrorMessage(displayMessage);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setConfirmDisconnectCredentialId(null);
      setEditingReplacement(false);
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
            {access === "allowed" ? "User account" :
              access === "unauthenticated" ? "Not signed in" :
                access === "forbidden" ? "Access required" :
                  access === "unavailable" ? "Access unavailable" : "Checking access…"}
          </span>
          {access === "allowed" || access === "forbidden" ? <TraderSignOut /> : null}
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

      {access === "unauthenticated" ? (
        <WaiaSurface variant="raised" className="mx-auto w-full max-w-lg space-y-3 p-6" data-testid="trader-auth-required">
          <h2 className="text-lg font-medium">Sign in to connect HTX</h2>
          <p className="text-muted-foreground text-sm">
            You can connect HTX after signing in to WAIA. Return to AI-TRADER after signing in.
          </p>
          <Link href={signInHref} className={buttonVariants({ className: "w-full" })} data-testid="trader-sign-in-link">
            Sign in or create an account
          </Link>
        </WaiaSurface>
      ) : access === "forbidden" ? (
        <WaiaSurface variant="raised" className="mx-auto w-full max-w-lg space-y-3 p-6" data-testid="trader-access-required">
          <h2 className="text-lg font-medium">No access to AI-TRADER</h2>
          <p className="text-muted-foreground text-sm">
            Sign in with an account that has AI-TRADER access or contact support. Connection data has not been loaded here.
          </p>
        </WaiaSurface>
      ) : access === "unavailable" ? (
        <WaiaSurface variant="raised" className="mx-auto w-full max-w-lg space-y-3 p-6" data-testid="trader-access-unavailable">
          <h2 className="text-lg font-medium">Access could not be checked</h2>
          <p className="text-muted-foreground text-sm">{errorMessage ?? asyncError}</p>
          <Button type="button" variant="outline" onClick={() => void loadWorkspace()}>
            Check again
          </Button>
        </WaiaSurface>
      ) : access === "loading" || loading ? (
        <p className="text-muted-foreground text-sm" role="status">Checking access and connections…</p>
      ) : (
        <div className="space-y-6">
          {accountOptions.length > 0 ? (
            <section aria-labelledby="trader-account-heading" className="space-y-4">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Accounts</p>
                <h2 id="trader-account-heading" className="mt-1 text-xl font-semibold">
                  HTX connections
                </h2>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <label htmlFor="trader-account-select" className="text-sm font-medium">
                    Select an account
                  </label>
                  <select
                    id="trader-account-select"
                    data-testid="trader-account-select"
                    value={selectedAccountId}
                    disabled={mutationBusy}
                    onChange={(event) => selectAccount(event.target.value)}
                    className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="">Select an account</option>
                    {accountOptions.map(({ accountId, credential }) => (
                      <option key={accountId} value={accountId}>
                        HTX {accountId} · {credential.status === "active" ? "Active in WAIA" : "Revoked in WAIA"}
                      </option>
                    ))}
                  </select>
                </div>
                {!addingNewAccount ? (
                  <Button type="button" variant="outline" disabled={mutationBusy} onClick={() => {
                    selectAccount("");
                    setAddingNewAccount(true);
                  }}>
                    Connect another account
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {accountOptions.length > 0 && !selectedCredential && !addingNewAccount ? (
            <div className="border-border bg-muted/10 rounded-lg border p-4 text-sm" data-testid="trader-account-selection-prompt">
              Select an account to view its status and history, or connect another.
            </div>
          ) : null}

          {selectedCredential ? (
            <section aria-label="Selected HTX account" className="space-y-4">
              <WaiaSurface variant="elevated" className="p-6">
                <CredentialStatus credential={selectedCredential} />
                {selectedCredential.status === "active" ? (
                  <div className="mt-4">
                    {!editingReplacement && !confirmDisconnect ? (
                      <Button type="button" variant="outline" disabled={mutationBusy} onClick={() => {
                        setConfirmDisconnectCredentialId(null);
                        setApiKey("");
                        setApiSecret("");
                        setAccountLabel("");
                        setEditingReplacement(true);
                      }} data-testid="trader-replace-button">
                        Replace connection
                      </Button>
                    ) : null}
                    {!confirmDisconnect ? (
                      <Button type="button" variant="outline" disabled={mutationBusy}
                        onClick={() => {
                          setEditingReplacement(false);
                          setApiKey("");
                          setApiSecret("");
                          setAccountLabel("");
                          setConfirmDisconnectCredentialId(selectedCredential.id);
                        }} data-testid="trader-disconnect-button">
                        Disconnect
                      </Button>
                    ) : (
                      <div className="border-border bg-muted/10 rounded-lg border p-4" role="group" aria-label="Confirm disconnection">
                        <p className="text-sm">Only the connection record in WAIA will be revoked. The HTX key and external executor will remain unchanged; history will be retained.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" variant="destructive" disabled={disconnecting}
                            onClick={handleDisconnect} data-testid="trader-disconnect-confirm">
                            {disconnecting ? "Disconnecting…" : "Confirm disconnection"}
                          </Button>
                          <Button type="button" variant="outline" disabled={mutationBusy}
                            onClick={() => setConfirmDisconnectCredentialId(null)}>Cancel</Button>
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
                Strategy, forecast, news and monthly reports have not been published in this cabinet yet.
                No conclusions are inferred.
              </p>
              <aside className="border-border bg-muted/10 rounded-lg border p-4 text-sm" data-testid="trader-authority-boundary">
                <p className="font-medium">Observation only</p>
                <p className="text-muted-foreground mt-1">
                  This cabinet is for observation only. Live activation, emergency
                  switches, strategy publication, administrative functions and capital
                  management are unavailable here.
                </p>
              </aside>
            </section>
          ) : null}

          {(accountOptions.length === 0 || addingNewAccount || selectedCredential?.status === "revoked" || editingReplacement) ? (
            <div className="mx-auto w-full max-w-lg space-y-6">
              <WaiaSurface variant="elevated" className="p-6" data-testid="trader-connect-section">
                <h2 className="text-lg font-medium">
                  Connect HTX
                </h2>
                {selectedCredential?.status === "active" ? (
                  <p className="mt-2 text-sm font-medium">This will replace the WAIA connection for the selected account, rather than add a separate observation key. The HTX key and external executor will remain unchanged; history will be retained.</p>
                ) : selectedCredential ? (
                  <p className="text-muted-foreground mt-1 text-sm">The previous connection record was revoked in WAIA. The entered key may belong to another HTX account; the account returned in the response will be selected. History will be retained.</p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-sm">
                    Connect an HTX HMAC key with Read or Read and Trade permissions. Withdraw must
                    remain disabled: WAIA uses the key only for observation and does not place orders.
                    Enter the Access Key and Secret Key below.
                  </p>
                )}
                <form className="mt-6 space-y-4" onSubmit={handleConnect} data-testid="trader-connect-form">
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-api-key">HTX Access Key</label>
                    <Input id="trader-api-key" name="htx-access-key" data-testid="trader-api-key" className="mt-1"
                      value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-api-secret">HTX Secret Key</label>
                    <Input id="trader-api-secret" name="htx-secret-key" data-testid="trader-api-secret" type="password" className="mt-1"
                      value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="new-password" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="trader-account-label">Account name (optional)</label>
                    <Input id="trader-account-label" data-testid="trader-account-label" className="mt-1"
                      value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} />
                  </div>
                  <PermissionExplainer />
                  <Button type="submit" disabled={mutationBusy} data-testid="trader-connect-submit" className="w-full">
                    {connecting ? "Connecting…" : selectedCredential?.status === "active"
                      ? "Replace connection"
                      : "Connect HTX"}
                  </Button>
                  {selectedCredential?.status === "active" || addingNewAccount ? (
                    <Button type="button" variant="outline" disabled={mutationBusy} onClick={cancelConnect}>
                      Cancel
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
export function TraderWorkspace({ signInHref = "/trader/sign-in" }: { signInHref?: string }): React.ReactNode {
  const runId = useSearchParams().get("campaign_run_id")?.trim() ?? "";
  return runId ? <HistoricalTraderWorkspace key={runId} /> : <ExchangeTraderWorkspace signInHref={signInHref} />;
}
