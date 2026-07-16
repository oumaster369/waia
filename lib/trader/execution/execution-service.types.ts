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
import type { LivePathAuthorizationHook } from "@/lib/trader/live/assert-live-path-authorized";
import type { LifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  HistoricalExecutionModelV1,
  SimulatedFillEvent,
} from "@/lib/trader/execution/historical-execution-model.types";
import type { HistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";

export type HistoricalExecutionRuntime = {
  enabled: boolean;
  model: HistoricalExecutionModelV1;
  exchange: HistoricalSimulatedExchange;
  getDecisionBarIndex: () => number;
  getReplayNowMs: () => number;
};

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
  strategyId?: string | null;
  strategyVersion?: string | null;
  allocationDecisionId?: string | null;
  openingMsvId?: string | null;
  openingFeatureSetId?: string | null;
  openingRegime?: import("@/lib/trader/intelligence/types").Regime | null;
  signalConfidence?: string | null;
  referencePrice: string;
  accountKey: string;
  accountState?: AccountRiskState;
  stopDistanceUsdt?: string;
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
  /** Injected only on bounded operator CLI path; Worker defaults omit this hook. */
  assertLiveAuthorized?: LivePathAuthorizationHook;
  lifecycleRecorder?: LifecycleRecorder;
  historicalExecution?: HistoricalExecutionRuntime;
};

export type OrderExecutionService = {
  submitOrder(context: OrgContext, input: SubmitOrderInput): Promise<SubmitOrderResult>;
  recordSimulatedFill?(
    context: OrgContext,
    order: OrderRow,
    event: SimulatedFillEvent,
    isFirstSlice: boolean,
  ): Promise<OrderRow>;
  transitionOrderExpired?(context: OrgContext, order: OrderRow): Promise<OrderRow>;
  transitionOrderCancelled?(context: OrgContext, order: OrderRow): Promise<OrderRow>;
};
