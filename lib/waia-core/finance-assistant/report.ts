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
}): Promise<FinanceAssistantReport> {
  const now = input.now ?? new Date();
  const context = requireOrgContext(input.organizationId);

  if (input.intent === "REPORT_OVERVIEW") {
    const [preview, allocation] = await Promise.all([
      input.services.breath.getAdminPreview(context),
      input.services.allocation.getCurrent(context),
    ]);
    return {
      kind: "overview",
      title: "Finance overview",
      generatedAt: now.toISOString(),
      data: { preview, funds: serializeFundAllocation(allocation) },
    };
  }

  if (input.intent === "REPORT_BUDGET") {
    const month = now.toISOString().slice(0, 7);
    const year = now.getUTCFullYear();
    const [monthly, annual] = await Promise.all([
      input.services.ledgerCatalog.getBudgetMonthSummary(context, month),
      input.services.ledgerCatalog.getBudgetAnnualSummary(context, year),
    ]);
    return {
      kind: "budget",
      title: `Budget report for ${month}`,
      generatedAt: now.toISOString(),
      data: {
        monthly: serializeCategoryBudgetMonth(monthly),
        annual: serializeCategoryBudgetAnnual(annual),
      },
    };
  }

  const transactions = await input.services.domain.repository.listTransactions(context, {
    limit: 50,
  });
  return {
    kind: "transactions",
    title: "Recent transactions",
    generatedAt: now.toISOString(),
    data: {
      count: transactions.length,
      transactions: transactions.map(serializeTransaction),
    },
  };
}
