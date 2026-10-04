"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ConnectedAccountsTable } from "@/components/trader/admin/connected-accounts-table";
import { FleetPortfolioPanel } from "@/components/trader/admin/fleet-portfolio-panel";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import { WaiaSurface } from "@/components/waia/waia-surface";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parent admin layout enforces verified operator admission; each API request
 * independently enforces organization/account authorization. No credentials here. */
export default function AdminAccountObservationPage() {
  const params = useSearchParams();
  const organizationId = params.get("organization_id")?.trim() ?? "";
  const credentialId = params.get("credential_id")?.trim() ?? "";
  const exchangeAccountId = params.get("exchange_account_id")?.trim() ?? "";
  const target =
    UUID_RE.test(organizationId) && UUID_RE.test(credentialId) && exchangeAccountId.length > 0
      ? { organizationId, credentialId, exchangeAccountId }
      : null;

  if (!target) {
    return (
      <main className="space-y-5">
        <FleetPortfolioPanel />
        <ConnectedAccountsTable />
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <WaiaSurface variant="raised" className="space-y-3 p-5">
        <p className="text-muted-foreground text-sm">
          <Link className="underline-offset-2 hover:underline" href="/admin/account-observation">
            Все счета HTX
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Счёт HTX</h1>
        <p className="text-waia-fg-muted text-sm">
          Здесь показан тот же снимок, что и в личном кабинете. Страница не подключается к HTX и не
          отправляет заявки.
        </p>
        <p className="font-mono text-sm">ID счёта HTX: {target.exchangeAccountId}</p>
      </WaiaSurface>
      <ConnectedAccountObservationPanel target={target} mode="admin" />
    </main>
  );
}
