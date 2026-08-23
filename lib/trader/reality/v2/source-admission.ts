import type { ExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import {
  REALITY_SOURCE_KINDS_V2,
  type RealityPrimitiveAssertionV2,
  type RealitySourceKindV2,
  type RealitySourceNativeIdentityV2,
  type RealitySourceReportV2,
  type RealitySubjectClassV2,
  validateRealitySourceReportV2,
} from "@/lib/trader/reality/v2/contracts";

export const EXCLUDED_REALITY_SOURCE_CLASSES_V2 = [
  "CHAIN",
  "HTX_PUBLIC_MARKET_DATA",
  "INTERNAL_EXPECTATION",
  "MODELLED_EFFECT",
  "PUBLIC_MARKET_DATA",
  "SIMULATOR",
  "SYNTHETIC_EFFECT",
  "WEBSOCKET",
] as const;

export type RealitySourceAdmissionDecisionV2 =
  | Readonly<{ status: "ADMITTED"; sourceKind: RealitySourceKindV2 }>
  | Readonly<{ status: "EXCLUDED"; reasonCode: "SOURCE_CLASS_NOT_RATIFIED" }>;

const SUBJECTS_BY_SOURCE: Readonly<Record<RealitySourceKindV2, readonly RealitySubjectClassV2[]>> = {
  EXECUTION_REPORT_V2: ["ORDER", "VENUE_EVENT", "FILL", "REALIZED_CASHFLOW"],
  HTX_SPOT_ORDER_REST: ["ORDER", "VENUE_EVENT"],
  HTX_SPOT_FILL_REST: ["FILL", "REALIZED_CASHFLOW"],
  HTX_SPOT_BALANCE_REST: ["BALANCE", "POSITION_INVENTORY"],
  HTX_SPOT_ACCOUNT_REST: ["ACCOUNT"],
};

const ASSERTION_BY_SUBJECT: Readonly<Record<RealitySubjectClassV2, RealityPrimitiveAssertionV2["kind"]>> = {
  ORDER: "ORDER",
  VENUE_EVENT: "VENUE_EVENT",
  FILL: "FILL",
  BALANCE: "BALANCE",
  ACCOUNT: "ACCOUNT",
  POSITION_INVENTORY: "POSITION_INVENTORY",
  REALIZED_CASHFLOW: "REALIZED_CASHFLOW",
};

const IDENTITY_BY_SOURCE: Readonly<
  Record<RealitySourceKindV2, RealitySourceNativeIdentityV2["identityKind"]>
> = {
  EXECUTION_REPORT_V2: "EXECUTION_REPORT_ID",
  HTX_SPOT_ORDER_REST: "HTX_ORDER_ID",
  HTX_SPOT_FILL_REST: "HTX_TRADE_ID",
  HTX_SPOT_BALANCE_REST: "HTX_BALANCE_SNAPSHOT_ID",
  HTX_SPOT_ACCOUNT_REST: "HTX_ACCOUNT_SNAPSHOT_ID",
};

export function classifyRealitySourceKindV2(value: unknown): RealitySourceAdmissionDecisionV2 {
  return typeof value === "string" && REALITY_SOURCE_KINDS_V2.includes(value as RealitySourceKindV2)
    ? Object.freeze({ status: "ADMITTED", sourceKind: value as RealitySourceKindV2 })
    : Object.freeze({ status: "EXCLUDED", reasonCode: "SOURCE_CLASS_NOT_RATIFIED" });
}

export function assertRealitySourceReportAdmissionV2(report: RealitySourceReportV2): void {
  if (!validateRealitySourceReportV2(report)) throw new Error("invalid RealitySourceReportV2");
  const decision = classifyRealitySourceKindV2(report.sourceKind);
  if (decision.status !== "ADMITTED") throw new Error(decision.reasonCode);
  if (!SUBJECTS_BY_SOURCE[report.sourceKind].includes(report.subject.subjectClass)) {
    throw new Error("source kind cannot assert this Reality subject class");
  }
  if (report.sourceKind === "EXECUTION_REPORT_V2") {
    if (report.lineage.lineageKind !== "EXECUTION_REPORT_V2" ||
      report.provenance.transport !== "INTERNAL_APPEND_ONLY") {
      throw new Error("ExecutionReportV2 requires exact append-only execution lineage");
    }
  } else if (report.lineage.lineageKind !== "RAW_CAPTURE_V1" ||
    report.provenance.transport !== "REST") {
    throw new Error("raw HTX Reality sources require encrypted raw-capture lineage");
  }
  if (report.sourceNativeIdentity !== null &&
    report.sourceNativeIdentity.identityKind !== IDENTITY_BY_SOURCE[report.sourceKind]) {
    throw new Error("source-native identity kind does not match source kind");
  }
  if (report.structuralVerification === "VERIFIED") {
    if (report.primitiveAssertion === null ||
      ASSERTION_BY_SUBJECT[report.subject.subjectClass] !== report.primitiveAssertion.kind) {
      throw new Error("primitive assertion does not match Reality subject class");
    }
    if ((report.subject.subjectClass === "FILL" ||
      report.subject.subjectClass === "REALIZED_CASHFLOW") &&
      report.sourceNativeIdentity === null) {
      throw new Error("fill and realized cashflow truth require exact source-native identity");
    }
  }
}

export function isExactExecutionReportV2Lineage(
  report: RealitySourceReportV2,
  executionReport: ExecutionReportV2,
): boolean {
  return report.sourceKind === "EXECUTION_REPORT_V2" &&
    report.lineage.lineageKind === "EXECUTION_REPORT_V2" &&
    report.lineage.executionReportId === executionReport.executionReportId &&
    report.lineage.executionReportDigestHex === executionReport.contentDigestHex &&
    report.organizationId === executionReport.organizationId &&
    report.accountId === executionReport.accountId;
}

