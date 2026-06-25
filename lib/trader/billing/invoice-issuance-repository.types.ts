import type { FeeComputationArtifact } from "@/lib/trader/billing/fee-computation.types";
import type { PeriodDisclosureSnapshot } from "@/lib/trader/billing/draft-invoice-service";
import type { HwmLedgerRecordPayload } from "@/lib/trader/billing/hwm-ledger.types";
import type { IssuanceAttestation } from "@/lib/trader/billing/invoice-issuance.types";
import type { IssuedInvoiceView } from "@/lib/trader/billing/invoice.types";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ExecuteInvoiceIssuanceRepoInput = {
  invoiceId: string;
  issuedAt: Date;
  issuedBy: string;
  artifact: FeeComputationArtifact;
  period: ReportingPeriodRecordView;
  disclosure: PeriodDisclosureSnapshot;
  hwmPayload: HwmLedgerRecordPayload;
  attestations: IssuanceAttestation;
  auditMetadata: Record<string, unknown>;
};

export type ExecuteInvoiceIssuanceRepoResult = {
  invoice: IssuedInvoiceView;
  hwmLedgerEntryId: string;
  auditLogId: string;
};

export type InvoiceIssuanceRepository = {
  executeAtomicIssuance(
    context: OrgContext,
    input: ExecuteInvoiceIssuanceRepoInput,
  ): ExecuteInvoiceIssuanceRepoResult | Promise<ExecuteInvoiceIssuanceRepoResult>;
};
