import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrderExecutionMode } from "@/lib/trader/execution/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { KillSwitchResolverPort, RiskEngineDecision } from "@/lib/trader/risk/evaluate.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { RiskEngineService } from "@/lib/trader/risk/evaluate.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type SubmissionAuditIds = {
  submissionStarted?: string;
  submitBlocked?: string;
  connectorUncertain?: string;
  connectorRejected?: string;
  connectorFilled?: string;
};

export type SubmitOrderInput = {
  clientOrderId: string;
  idempotencyKey: string;
  executionMode: OrderExecutionMode;
  symbol: string;
  side: PlaceOrderInput["side"];
  type: PlaceOrderInput["type"];
  price?: string;
  quantity: string;
  credentialId?: string | null;
  strategySignalId?: string | null;
  allocationDecisionId?: string | null;
  referencePrice: string;
  accountKey: string;
  accountState?: AccountRiskState;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type SubmitOrderResult =
  | { status: "risk_rejected"; riskDecision: RiskEngineDecision; order: null }
  | {
      status: "submitted";
      order: OrderRow;
      riskDecision?: RiskEngineDecision;
      auditIds?: SubmissionAuditIds;
    }
  | { status: "submit_blocked"; order: OrderRow; reason: "kill_switch" }
  | { status: "connector_uncertain"; order: OrderRow }
  | { status: "conflict"; orderId: string };

export type OrderExecutionServiceDeps = {
  riskEngine: RiskEngineService;
  orderRepository: OrderRepository;
  killSwitchResolver: KillSwitchResolverPort;
  connectorForMode: (executionMode: OrderExecutionMode) => ExchangeConnector;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  nowMs: () => number;
  executionTelemetrySink?: WaiaTraderTelemetrySink;
};

export type OrderExecutionService = {
  submitOrder(context: OrgContext, input: SubmitOrderInput): Promise<SubmitOrderResult>;
};
