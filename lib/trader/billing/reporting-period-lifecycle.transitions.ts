import type { ReportingPeriodStatus } from "@/lib/trader/billing/reporting-period.types";
import { ReportingPeriodInvalidTransitionError } from "@/lib/trader/billing/reporting-period.errors";

export const REPORTING_PERIOD_TRANSITIONS: Readonly<
  Record<ReportingPeriodStatus, readonly ReportingPeriodStatus[]>
> = {
  OPEN: ["CLOSED"],
  CLOSED: [],
};

export function assertAllowedReportingPeriodTransition(
  from: ReportingPeriodStatus,
  to: ReportingPeriodStatus,
): void {
  if (!REPORTING_PERIOD_TRANSITIONS[from].includes(to)) {
    throw new ReportingPeriodInvalidTransitionError(from, to);
  }
}

export function isTerminalReportingPeriodStatus(status: ReportingPeriodStatus): boolean {
  return REPORTING_PERIOD_TRANSITIONS[status].length === 0;
}
