import type { InvoiceRecordView, IssuedInvoiceView } from "@/lib/trader/billing/invoice.types";
import type { FeeComputationService } from "@/lib/trader/billing/fee-computation-service";
import type { HwmLedgerRepository } from "@/lib/trader/billing/hwm-ledger-repository.types";
import type { InvoiceIssuanceRepository } from "@/lib/trader/billing/invoice-issuance-repository.types";
import type { InvoiceRepository } from "@/lib/trader/billing/invoice-repository.types";
import type { ReportingPeriodRepository } from "@/lib/trader/billing/reporting-period-repository.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type IssuanceAttestation = {
  depositsVerified: boolean;
  withdrawalsVerified: boolean;
  balanceSnapshotsVerified: boolean;
  reconciliationVerified: boolean;
  exchangeSyncVerified: boolean;
  realizedFillFinalityVerified: boolean;
};

export const ISSUANCE_ATTESTATION_KEYS = [
  "depositsVerified",
  "withdrawalsVerified",
  "balanceSnapshotsVerified",
  "reconciliationVerified",
  "exchangeSyncVerified",
  "realizedFillFinalityVerified",
] as const satisfies readonly (keyof IssuanceAttestation)[];

export function isIssuanceAttestationComplete(attestation: IssuanceAttestation): boolean {
  return ISSUANCE_ATTESTATION_KEYS.every((key) => attestation[key]);
}

export type ApproveIssuanceInput = {
  invoiceId: string;
  attestations: IssuanceAttestation;
  coolingOffMs?: number | null;
  approvedAt?: Date;
};

export type CancelPendingIssuanceInput = {
  invoiceId: string;
  reason: string;
};

export type IssueInvoiceInput = {
  invoiceId: string;
  issuedAt?: Date;
};

export type { IssuedInvoiceView };

export type InvoiceIssuanceService = {
  approveInvoiceIssuance(
    context: OrgContext & { userId?: string },
    input: ApproveIssuanceInput,
  ): Promise<InvoiceRecordView>;

  cancelPendingIssuance(
    context: OrgContext & { userId?: string },
    input: CancelPendingIssuanceInput,
  ): Promise<InvoiceRecordView>;

  issueInvoice(
    context: OrgContext & { userId?: string },
    input: IssueInvoiceInput,
  ): Promise<IssuedInvoiceView>;
};

export type InvoiceIssuanceServiceDeps = {
  feeComputationService: FeeComputationService;
  reportingPeriodRepository: ReportingPeriodRepository;
  invoiceRepository: InvoiceRepository;
  hwmLedgerRepository: HwmLedgerRepository;
  issuanceRepository: InvoiceIssuanceRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
  now?: () => Date;
};
