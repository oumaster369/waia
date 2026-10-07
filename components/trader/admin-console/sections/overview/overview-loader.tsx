"use client";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { ConsoleLoading } from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { ConnectedAccountsTable } from "@/components/trader/admin/connected-accounts-table";
import { OverviewFuturesSummaryView } from "@/components/trader/admin-console/sections/overview/overview-futures-summary-view";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import {
  OverviewFinancialDetails,
  AccountsPreview,
  NewsPanel,
  FillsPreview,
  ActivityPanel,
  ClientsPreview,
  ResearchPreview,
  type OverviewData,
} from "@/components/trader/admin-console/sections/overview/overview-content";
import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";
import { observationBindingSchema } from "@/lib/trader/account-observation/validation";
export function OverviewLoader() {
  const { params } = useAdminReadContext();
  if (params.get("tab") === "market") return <NewsPanel full />;
  if (params.get("tab") === "algorithm") return <ActivityPanel full />;
  return <OverviewSummary />;
}
function OverviewSummary() {
  const read = useAdminRead<OverviewData>("/api/trader/admin/console/overview");
  const { params } = useAdminReadContext();
  const organizationValues = params.getAll("organization_id");
  const accountValues = params.getAll("exchange_account_id");
  const rawOrganizationId = organizationValues.length === 1 ? organizationValues[0] : null;
  const rawExchangeAccountId = accountValues.length === 1 ? accountValues[0] : null;
  const organizationId = rawOrganizationId || null;
  const exchangeAccountId = rawExchangeAccountId || null;
  const mode = params.get("mode") ?? "live";
  const duplicateScope = organizationValues.length > 1 || accountValues.length > 1;
  const invalidOrganization =
    rawOrganizationId !== null &&
    rawOrganizationId !== "" &&
    !observationBindingSchema.shape.organizationId.safeParse(rawOrganizationId).success;
  const invalidAccount =
    rawExchangeAccountId !== null &&
    rawExchangeAccountId !== "" &&
    (rawExchangeAccountId.length > 256 ||
      rawExchangeAccountId.trim() === "" ||
      rawExchangeAccountId !== rawExchangeAccountId.trim());
  const accountWithoutOrganization = exchangeAccountId !== null && organizationId === null;
  const invalidScope =
    duplicateScope || invalidOrganization || invalidAccount || accountWithoutOrganization;
  const scopeKey = `overview:${JSON.stringify([organizationId, exchangeAccountId])}`;
  const futures =
    mode === "live" && !invalidScope ? (
      <ConnectedAccountsTable
        key={scopeKey}
        variant="overview"
        organizationId={organizationId}
        exchangeAccountId={exchangeAccountId}
      />
    ) : (
      <OverviewFuturesSummaryView
        summary={null}
        unavailableReason={
          accountWithoutOrganization && !duplicateScope && !invalidAccount
            ? "Для фильтра по счёту сначала выберите клиента."
            : invalidScope
              ? "Проверьте фильтр клиента и счёта."
              : "Наблюдения фьючерсов доступны только в контуре Live."
        }
      />
    );

  if (read.loading)
    return (
      <div className="space-y-5">
        <ConsoleLoading />
        {futures}
      </div>
    );
  const view = read.envelope ? overviewFromEnvelope(read.envelope) : null;
  const spot =
    view?.state === "unavailable" ? (
      <>
        <h2 className="px-1 text-lg font-semibold">Спот</h2>
        <DataState state="unavailable" reason={view.reason} />
      </>
    ) : view ? (
      <OverviewPanel view={view} />
    ) : read.reason ? (
      <>
        <h2 className="px-1 text-lg font-semibold">Спот</h2>
        <DataState state="unavailable" reason={read.reason} />
      </>
    ) : null;
  return (
    <div className="space-y-5">
      <section aria-label="Спот" className="space-y-4">
        {spot}
      </section>
      {futures}
      {read.envelope && view?.state === "ready" ? (
        <>
          <OverviewFinancialDetails data={read.envelope.data} />
          <AccountsPreview data={read.envelope.data} />
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <FillsPreview />
            <ActivityPanel />
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <ClientsPreview />
            <ResearchPreview />
          </div>
          <NewsPanel />
        </>
      ) : null}
    </div>
  );
}
