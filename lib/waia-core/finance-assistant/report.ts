import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { TreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import {
  serializeCategoryBudgetAnnual,
  serializeCategoryBudgetMonth,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-serialize";
import {
  serializeFundAllocation,
  serializeTransaction,
  serializeWatchedAddress,
} from "@/lib/waia-core/treasury/admin/serialize";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  FinanceAssistantIntentName,
  FinanceAssistantReport,
} from "@/lib/waia-core/finance-assistant/types";

export async function buildFinanceAssistantReport(input: {
  intent: FinanceAssistantIntentName;
  organizationId: string;
  services: TreasuryAdminServices;
  now?: Date;
  language?: "ru" | "en";
}): Promise<FinanceAssistantReport> {
  const now = input.now ?? new Date();
  const context = requireOrgContext(input.organizationId);

  if (input.intent === "REPORT_OVERVIEW") {
    const [preview, allocation] = await Promise.all([
      input.services.breath.getAdminPreview(context),
      input.services.allocation.getCurrent(context),
    ]);
    const funds = serializeFundAllocation(allocation);
    return {
      kind: "overview",
      title: input.language === "ru" ? "Финансовый обзор" : "Finance overview",
      generatedAt: now.toISOString(),
      data: {
        availableNowMicros: preview.currentFreeFunds,
        annualBudget: preview.idealAnnualBudget,
        runway: preview.runway,
        operatingFundMicros: funds.status === "available" ? funds.operatingAllocationMicros : null,
        developmentFundMicros:
          funds.status === "available" ? funds.developmentAllocationMicros : null,
        accountingCurrency: funds.status === "available" ? funds.accountingCurrency : "USD",
        pendingReasons: preview.pendingReasons,
      },
    };
  }

  if (input.intent === "REPORT_BUDGET") {
    const month = now.toISOString().slice(0, 7);
    const year = now.getUTCFullYear();
    const [monthly, annual] = await Promise.all([
      input.services.ledgerCatalog.getBudgetMonthSummary(context, month),
      input.services.ledgerCatalog.getBudgetAnnualSummary(context, year),
    ]);
    const monthlyDto = serializeCategoryBudgetMonth(monthly);
    const annualDto = serializeCategoryBudgetAnnual(annual);
    return {
      kind: "budget",
      title: input.language === "ru" ? `Бюджет за ${month}` : `Budget report for ${month}`,
      generatedAt: now.toISOString(),
      data: {
        month: monthlyDto.month,
        currentMonthTotals: monthlyDto.totals,
        groups: monthlyDto.groups,
        annualTotals: annualDto.totals,
        recordedMonths: annualDto.months.map((row) => row.month),
      },
    };
  }

  if (input.intent === "REPORT_WALLET") {
    const watched = await input.services.catalog.listWatchedAddresses(context);
    return {
      kind: "wallet",
      title: input.language === "ru" ? "Наблюдаемые кошельки" : "Observed wallets",
      generatedAt: now.toISOString(),
      data: {
        count: watched.length,
        wallets: watched.map((row) => {
          const serialized = serializeWatchedAddress(row);
          return {
            id: serialized.id,
            label: serialized.label,
            network: serialized.network,
            assetCode: serialized.assetCode,
            address: serialized.address,
            directionScope: serialized.directionScope,
            includeInBalanceRecon: serialized.includeInBalanceRecon,
            isActive: serialized.isActive,
          };
        }),
      },
    };
  }

  const transactions = await input.services.domain.repository.listTransactions(context, {
    limit: 50,
  });
  return {
    kind: "transactions",
    title: input.language === "ru" ? "Последние транзакции" : "Recent transactions",
    generatedAt: now.toISOString(),
    data: {
      count: transactions.length,
      transactions: transactions.map((transaction) => {
        const row = serializeTransaction(transaction);
        return {
          id: row.id,
          occurredAt: row.occurredAt,
          signedAmountMicros: row.signedAmountMicros,
          status: row.status,
          counterparty: row.counterpartyDisplay,
          category: row.category,
          purpose: row.purpose,
          notes: row.internalNotes,
        };
      }),
    },
  };
}
