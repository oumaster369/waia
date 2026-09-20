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
      <p className="text-foreground font-medium">How to create the HTX key</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>On HTX open API Management and create an HMAC API key.</li>
        <li>
          Enable <span className="text-foreground">Read</span> only. Do not enable Withdraw. Trade
          is not required for this cabinet.
        </li>
        <li>
          Leave the IP whitelist empty, then paste Access Key and Secret below. The secret is shown
          only once.
        </li>
        <li>
          After Connect succeeds, edit the same HTX key and IP-whitelist only{" "}
          <span className="text-foreground font-mono">84.32.9.146</span>.
        </li>
      </ol>
      <p className="mt-2 text-xs">
        HTX spot uses API key + secret only (no passphrase). This is your personal AI-TRADER
        account. Nobody else is joined to it.
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
        <span className="text-sm font-medium">HTX connected</span>
        <span
          data-testid="trader-credential-status"
          className="bg-muted rounded-full px-2 py-0.5 text-xs capitalize"
        >
          {credential.status}
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
            <dt className="text-muted-foreground">Scopes</dt>
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

function ExchangeTraderWorkspace() {
  const [credentials, setCredentials] = React.useState<CredentialMetadataDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [accountLabel, setAccountLabel] = React.useState("");
  const scope = React.useRef(0);
  const pending = React.useRef(new Map<string, object>());
  const asyncError =
    "Connect did not complete. Keep HTX IP restrictions empty (do not whitelist 84.32.9.146 yet) and retry once.";

  const activeCredential = credentials.find((c) => c.status === "active") ?? credentials[0];

  const loadWorkspace = React.useCallback(async () => {
    const generation = ++scope.current;
    pending.current.clear();
    setConnecting(false);
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await listExchangeCredentialsClient();
      if (scope.current !== generation) return;
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        setCredentials([]);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setCredentials(result.data);
    } catch {
      if (scope.current === generation) setErrorMessage(asyncError);
    } finally {
      if (scope.current === generation) setLoading(false);
    }
  }, []);

  const retireScope = React.useCallback(() => {
    ++scope.current;
  }, []);
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
    if (pending.current.has(name)) return;
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
      setErrorMessage("API key and secret are required.");
      return;
    }
    runRequest("connect", setConnecting, async (isCurrent) => {
      const result = await connectHtxClient({
        apiKey: trimmedKey,
        apiSecret: trimmedSecret,
        accountLabel: accountLabel.trim() || undefined,
      });
      if (!isCurrent()) return;
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setApiKey("");
      setApiSecret("");
      setConnecting(false);
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
        <p className="text-muted-foreground text-sm">Loading account…</p>
      ) : activeCredential ? (
        <div className="space-y-6">
          <section aria-labelledby="trader-account-heading" className="space-y-4">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">Account</p>
              <h2 id="trader-account-heading" className="mt-1 text-xl font-semibold">
                HTX connection
              </h2>
            </div>
            <WaiaSurface variant="elevated" className="p-6">
              <CredentialStatus credential={activeCredential} />
            </WaiaSurface>
          </section>
          <ConnectedAccountObservationPanel
            key={`${activeCredential.id}:${activeCredential.status}:${activeCredential.updatedAt}`}
            target={
              activeCredential.status === "active"
                ? {
                    credentialId: activeCredential.id,
                    exchangeAccountId: activeCredential.exchangeAccountId,
                  }
                : null
            }
          />
          <p className="text-muted-foreground text-sm" data-testid="trader-unpublished-note">
            Strategy, forecast, news and monthly statement are not published in this cabinet yet.
            Nothing is inferred.
          </p>
          <aside
            className="border-border bg-muted/10 rounded-lg border p-4 text-sm"
            data-testid="trader-authority-boundary"
          >
            <p className="font-medium">Observation only</p>
            <p className="text-muted-foreground mt-1">
              This dashboard is observational. Live enablement, kill switches, strategy promotion,
              administrative controls and capital changes are intentionally absent.
            </p>
          </aside>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-lg space-y-6">
          <WaiaSurface variant="elevated" className="p-6" data-testid="trader-connect-section">
            <h2 className="text-lg font-medium">Connect HTX</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Create a Read-only HTX HMAC key. Do not enable Withdraw. Paste the Access Key and
              Secret Key below.
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={handleConnect}
              data-testid="trader-connect-form"
            >
              <div>
                <label className="text-sm font-medium" htmlFor="trader-api-key">
                  HTX Access Key
                </label>
                <Input
                  id="trader-api-key"
                  data-testid="trader-api-key"
                  className="mt-1"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="trader-api-secret">
                  HTX Secret Key
                </label>
                <Input
                  id="trader-api-secret"
                  data-testid="trader-api-secret"
                  type="password"
                  className="mt-1"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="trader-account-label">
                  Account label (optional)
                </label>
                <Input
                  id="trader-account-label"
                  data-testid="trader-account-label"
                  className="mt-1"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                />
              </div>
              <PermissionExplainer />
              <Button
                type="submit"
                disabled={connecting}
                data-testid="trader-connect-submit"
                className="w-full"
              >
                {connecting ? "Connecting…" : "Connect HTX"}
              </Button>
            </form>
          </WaiaSurface>
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
