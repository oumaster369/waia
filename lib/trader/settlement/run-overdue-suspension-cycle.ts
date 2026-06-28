import type { AccountStatusRepository } from "@/lib/trader/settlement/account-status-repository.types";
import { DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS } from "@/lib/trader/settlement/account-status-policy";
import { appendAccountSuspensionIfNeeded } from "@/lib/trader/settlement/append-account-suspension";
import type { OverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader.port";
import type { SettlementLogger } from "@/lib/trader/settlement/settlement-logger";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type OverdueSuspensionCycleReport = {
  outcome: "completed" | "noop" | "error";
  processed: number;
  suspended: number;
  skipped: number;
  backlog: number;
  durationMs: number;
  errorMessage: string | null;
};

export type OverdueSuspensionCycleDeps = {
  overdueInvoicesReader: OverdueInvoicesReader;
  accountStatusRepository: AccountStatusRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  logger: SettlementLogger;
  gracePeriodMs?: number;
  maxAccountsPerCycle?: number;
  now?: () => Date;
};

function accountKey(organizationId: string, exchangeAccountId: string): string {
  return `${organizationId}:${exchangeAccountId}`;
}

export async function runOverdueSuspensionCycle(
  deps: OverdueSuspensionCycleDeps,
): Promise<OverdueSuspensionCycleReport> {
  const startMs = Date.now();
  const gracePeriodMs = deps.gracePeriodMs ?? DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS;
  const maxAccounts = deps.maxAccountsPerCycle ?? 50;
  const asOf = deps.now?.() ?? new Date();
  let processed = 0;
  let suspended = 0;
  let skipped = 0;

  try {
    const overdueInvoices = await deps.overdueInvoicesReader.listOverdueIssuedInvoices(
      asOf,
      gracePeriodMs,
      maxAccounts * 2,
    );
    const backlog = await deps.overdueInvoicesReader.countOverdueIssuedInvoices(
      asOf,
      gracePeriodMs,
    );

    const seenAccounts = new Set<string>();
    for (const invoice of overdueInvoices) {
      const key = accountKey(invoice.organizationId, invoice.exchangeAccountId);
      if (seenAccounts.has(key)) {
        continue;
      }
      if (processed >= maxAccounts) {
        break;
      }
      seenAccounts.add(key);
      processed += 1;

      const context = requireOrgContext(invoice.organizationId);
      try {
        const didSuspend = await appendAccountSuspensionIfNeeded(
          {
            accountStatusRepository: deps.accountStatusRepository,
            writeAudit: deps.writeAudit,
          },
          context,
          {
            exchangeAccountId: invoice.exchangeAccountId,
            sourceInvoiceId: invoice.id,
            now: asOf,
          },
        );
        if (didSuspend) {
          suspended += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        deps.logger.log({
          event: "waia_overdue_suspension_cycle",
          phase: "account_skipped",
          organizationId: invoice.organizationId,
          exchangeAccountId: invoice.exchangeAccountId,
          invoiceId: invoice.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report: OverdueSuspensionCycleReport = {
      outcome: processed === 0 ? "noop" : "completed",
      processed,
      suspended,
      skipped,
      backlog,
      durationMs: Date.now() - startMs,
      errorMessage: null,
    };

    deps.logger.log({
      event: "waia_overdue_suspension_cycle",
      phase: "cycle_complete",
      ...report,
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.log({
      event: "waia_overdue_suspension_cycle",
      phase: "cycle_error",
      error: message,
    });
    return {
      outcome: "error",
      processed,
      suspended,
      skipped,
      backlog: 0,
      durationMs: Date.now() - startMs,
      errorMessage: message,
    };
  }
}
