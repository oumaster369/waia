"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { CredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";
import type { BalanceSnapshotDto } from "@/lib/trader/balances/types";
import type { PositionSnapshotDto } from "@/lib/trader/positions/types";
import type { TradeHistorySnapshotDto } from "@/lib/trader/trade-history/types";
import {
  assertNoSecretsInPayload,
  connectHtxClient,
  listBalanceSnapshotsClient,
  listExchangeCredentialsClient,
  listPositionSnapshotsClient,
  listTradeHistorySnapshotsClient,
  syncBalancesClient,
  syncPositionsClient,
  syncTradeHistoryClient,
} from "@/lib/trader/trader-workspace-client";
import { parseHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import {
  normalizeHtxSpotSymbol,
  TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE,
} from "@/lib/trader/symbols/normalize-htx-spot-symbol";

const DEFAULT_TRADE_SYMBOL = "ETH/USDT";

const dateFormatter =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return dateFormatter ? dateFormatter.format(d) : d.toLocaleString();
  } catch {
    return iso;
  }
}

function PermissionExplainer() {
  return (
    <div
      data-testid="trader-permission-explainer"
      className="border-border bg-muted/20 text-muted-foreground rounded-lg border p-4 text-sm"
    >
      <p className="text-foreground font-medium">HTX API key permissions (spot)</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <span className="text-foreground">Required:</span> Read and Trade scopes for balance and
          position sync.
        </li>
        <li>
          <span className="text-foreground">Forbidden:</span> Withdraw and Transfer — WAIA rejects
          keys with withdraw permission.
        </li>
      </ul>
      <p className="mt-2 text-xs">
        HTX spot uses API key + secret only (no passphrase). Secrets are encrypted server-side and
        never shown again after connect.
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

function BalancesPanel({
  snapshots,
  syncing,
  onSync,
}: {
  snapshots: BalanceSnapshotDto[];
  syncing: boolean;
  onSync: () => void;
}) {
  const latest = snapshots[0];
  return (
    <WaiaSurface variant="raised" className="p-5" data-testid="trader-balances-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Balances</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={syncing}
          data-testid="trader-sync-balances"
          onClick={onSync}
        >
          {syncing ? "Syncing…" : "Sync balances"}
        </Button>
      </div>
      {latest ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Last sync: {formatTimestamp(latest.syncedAt)}
          </p>
          <ul className="divide-border divide-y" data-testid="trader-balance-list">
            {latest.balances.map((balance) => (
              <li key={balance.asset} className="flex justify-between py-2">
                <span>{balance.asset.toUpperCase()}</span>
                <span>{balance.total}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No balance snapshot yet. Sync to fetch HTX balances.
        </p>
      )}
    </WaiaSurface>
  );
}

function PositionsPanel({
  snapshots,
  syncing,
  onSync,
}: {
  snapshots: PositionSnapshotDto[];
  syncing: boolean;
  onSync: () => void;
}) {
  const latest = snapshots[0];
  return (
    <WaiaSurface variant="raised" className="p-5" data-testid="trader-positions-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Positions</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={syncing}
          data-testid="trader-sync-positions"
          onClick={onSync}
        >
          {syncing ? "Syncing…" : "Sync positions"}
        </Button>
      </div>
      {latest && latest.positions.length > 0 ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Last sync: {formatTimestamp(latest.syncedAt)}
          </p>
          <ul className="divide-border divide-y" data-testid="trader-position-list">
            {latest.positions.map((position) => (
              <li key={position.symbol} className="flex justify-between py-2">
                <span>{position.symbol}</span>
                <span>{position.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {latest
            ? "No open spot positions."
            : "No position snapshot yet. Sync to fetch HTX positions."}
        </p>
      )}
    </WaiaSurface>
  );
}

function TradeHistoryPanel({
  symbol,
  onSymbolChange,
  snapshots,
  syncing,
  onSync,
}: {
  symbol: string;
  onSymbolChange: (value: string) => void;
  snapshots: TradeHistorySnapshotDto[];
  syncing: boolean;
  onSync: () => void;
}) {
  const latest = snapshots[0];
  return (
    <WaiaSurface variant="raised" className="p-5" data-testid="trader-trades-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Recent trades</h2>
          <label className="text-muted-foreground mt-2 block text-xs" htmlFor="trader-trade-symbol">
            Symbol (HTX spot pair)
          </label>
          <Input
            id="trader-trade-symbol"
            data-testid="trader-trade-symbol"
            className="mt-1 max-w-xs"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            placeholder="ETH/USDT"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            Use an HTX spot pair with trade history, e.g. ETH/USDT.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={syncing || symbol.length === 0}
          data-testid="trader-sync-trades"
          onClick={onSync}
        >
          {syncing ? "Syncing…" : "Sync trades"}
        </Button>
      </div>
      {latest && latest.trades.length > 0 ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Last sync ({latest.symbol}): {formatTimestamp(latest.syncedAt)}
          </p>
          <ul className="divide-border divide-y" data-testid="trader-trade-list">
            {latest.trades.slice(0, 10).map((trade) => (
              <li key={trade.tradeId} className="flex justify-between gap-2 py-2">
                <span>
                  {trade.side.toUpperCase()} {trade.quantity} @ {trade.price}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatTimestamp(trade.executedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {latest ? "No trades in the last 48h window." : "Sync to fetch recent HTX trade history."}
        </p>
      )}
    </WaiaSurface>
  );
}

export function TraderWorkspace() {
  const [credentials, setCredentials] = React.useState<CredentialMetadataDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState(false);
  const [syncingBalances, setSyncingBalances] = React.useState(false);
  const [syncingPositions, setSyncingPositions] = React.useState(false);
  const [syncingTrades, setSyncingTrades] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [accountLabel, setAccountLabel] = React.useState("");
  const [balanceSnapshots, setBalanceSnapshots] = React.useState<BalanceSnapshotDto[]>([]);
  const [positionSnapshots, setPositionSnapshots] = React.useState<PositionSnapshotDto[]>([]);
  const [tradeSnapshots, setTradeSnapshots] = React.useState<TradeHistorySnapshotDto[]>([]);
  const [tradeSymbol, setTradeSymbol] = React.useState(DEFAULT_TRADE_SYMBOL);

  const activeCredential = credentials.find((c) => c.status === "active") ?? credentials[0];

  const refreshSnapshots = React.useCallback(async (credentialId: string, symbol: string) => {
    const normalized = normalizeHtxSpotSymbol(symbol);
    const listSymbol = normalized.ok ? normalized.symbol : symbol.trim();
    const [balances, positions, trades] = await Promise.all([
      listBalanceSnapshotsClient(credentialId),
      listPositionSnapshotsClient(credentialId),
      listTradeHistorySnapshotsClient(credentialId, listSymbol),
    ]);
    if (balances.kind === "ok") {
      setBalanceSnapshots(balances.data);
    }
    if (positions.kind === "ok") {
      setPositionSnapshots(positions.data);
    }
    if (trades.kind === "ok") {
      setTradeSnapshots(trades.data);
    }
  }, []);

  const loadWorkspace = React.useCallback(
    async (symbol: string) => {
      setLoading(true);
      setErrorMessage(null);
      const result = await listExchangeCredentialsClient();
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        setCredentials([]);
        setLoading(false);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setCredentials(result.data);
      setLoading(false);
      const active = result.data.find((c) => c.status === "active") ?? result.data[0];
      if (active) {
        await refreshSnapshots(active.id, symbol);
      }
    },
    [refreshSnapshots],
  );

  React.useEffect(() => {
    void (async () => {
      await loadWorkspace(DEFAULT_TRADE_SYMBOL);
    })();
  }, [loadWorkspace]);

  const handleTradeSymbolChange = (value: string) => {
    setTradeSymbol(value);
    if (activeCredential && value.trim()) {
      const normalized = normalizeHtxSpotSymbol(value);
      if (!normalized.ok) {
        setTradeSnapshots([]);
        return;
      }
      void listTradeHistorySnapshotsClient(activeCredential.id, normalized.symbol).then(
        (result) => {
          if (result.kind === "ok") {
            setTradeSnapshots(result.data);
          }
        },
      );
    }
  };

  const handleConnect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();
    if (!trimmedKey || !trimmedSecret) {
      setErrorMessage("API key and secret are required.");
      return;
    }
    setConnecting(true);
    setErrorMessage(null);
    void (async () => {
      const result = await connectHtxClient({
        apiKey: trimmedKey,
        apiSecret: trimmedSecret,
        accountLabel: accountLabel.trim() || undefined,
      });
      setConnecting(false);
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        return;
      }
      assertNoSecretsInPayload(JSON.stringify(result.data));
      setApiKey("");
      setApiSecret("");
      await loadWorkspace(tradeSymbol);
    })();
  };

  const handleSyncBalances = () => {
    if (!activeCredential) {
      return;
    }
    setSyncingBalances(true);
    setErrorMessage(null);
    void (async () => {
      const result = await syncBalancesClient(activeCredential.id);
      setSyncingBalances(false);
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        return;
      }
      await refreshSnapshots(activeCredential.id, tradeSymbol);
    })();
  };

  const handleSyncPositions = () => {
    if (!activeCredential) {
      return;
    }
    setSyncingPositions(true);
    setErrorMessage(null);
    void (async () => {
      const result = await syncPositionsClient(activeCredential.id);
      setSyncingPositions(false);
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        return;
      }
      await refreshSnapshots(activeCredential.id, tradeSymbol);
    })();
  };

  const handleSyncTrades = () => {
    if (!activeCredential || !tradeSymbol.trim()) {
      return;
    }
    const normalized = normalizeHtxSpotSymbol(tradeSymbol);
    if (!normalized.ok) {
      setErrorMessage(TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE);
      return;
    }
    setSyncingTrades(true);
    setErrorMessage(null);
    void (async () => {
      const result = await syncTradeHistoryClient(activeCredential.id, normalized.symbol);
      setSyncingTrades(false);
      if (result.kind === "err") {
        setErrorMessage(result.displayMessage);
        return;
      }
      setTradeSymbol(normalized.symbol);
      await refreshSnapshots(activeCredential.id, normalized.symbol);
    })();
  };

  return (
    <div
      data-testid="trader-workspace"
      className="bg-background flex min-h-screen flex-col px-6 py-10 md:px-10"
    >
      <header className="border-border mb-10 border-b pb-6">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA Module</p>
        <h1
          data-testid="trader-workspace-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          AI-TRADER
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Exchange connect and account status</p>
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
          <WaiaSurface variant="elevated" className="p-6">
            <CredentialStatus credential={activeCredential} />
          </WaiaSurface>
          <div className="grid gap-4 lg:grid-cols-3">
            <BalancesPanel
              snapshots={balanceSnapshots}
              syncing={syncingBalances}
              onSync={handleSyncBalances}
            />
            <PositionsPanel
              snapshots={positionSnapshots}
              syncing={syncingPositions}
              onSync={handleSyncPositions}
            />
            <TradeHistoryPanel
              symbol={tradeSymbol}
              onSymbolChange={handleTradeSymbolChange}
              snapshots={tradeSnapshots}
              syncing={syncingTrades}
              onSync={handleSyncTrades}
            />
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-lg space-y-6">
          <WaiaSurface variant="elevated" className="p-6" data-testid="trader-connect-section">
            <h2 className="text-lg font-medium">Connect HTX</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Create an HTX API key with Read + Trade permissions. Do not enable Withdraw. Paste the
              Access Key and Secret Key from HTX below.
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
