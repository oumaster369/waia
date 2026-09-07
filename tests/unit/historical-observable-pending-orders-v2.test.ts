import { describe, expect, it } from "vitest";
import { projectHistoricalPendingOrdersV2 } from "@/lib/trader/historical-simulation-v2/observable-pending-orders-v2";
import { createHistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationDurableOrderV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const scope={organizationId:"org",accountId:"account",runId:"run",cycleId:"cycle",split:"WALK_FORWARD" as const};
function fixture(overrides: Partial<HistoricalSimulationDurableOrderV2>={}, remaining="1", cancel=false) {
  const body={id:"order",organizationId:"org",credentialId:null,venue:"HTX",executionMode:"mock" as const,
    historicalRunId:"run",historicalAccountKey:"account",symbol:"BTCUSDT",side:"buy" as const,type:"market" as const,
    price:null,quantity:"1",filledQuantity:"0",avgFillPrice:null,state:"ACCEPTED" as const,stateVersion:1,
    exchangeOrderId:null,clientOrderId:"internal-client",idempotencyKey:"internal-retry",riskDecisionId:"risk",
    strategySignalId:null,allocationDecisionId:null,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",
    ...overrides};
  const order={...body,contentDigestHex:computeSemanticSha256Hex(body)};
  return createHistoricalSimulationDurableStateSnapshotV2({...scope,stateKind:"MODELED_EXCHANGE",state:{
    openOrders:[order],checkpoint:{schemaVersion:"htr-wp17-execution-checkpoint/v1",
      executionModelSchemaVersion:"waia.trader.historical-execution-model.v1",openOrders:[{
        orderId:"order",acceptedAtTs:1,firstEligibleTs:2,windowEndBarIndex:3,sameSymbolEligibleBarsSeen:0,
        remainingQty:remaining,filledQty:body.filledQuantity,fillSequence:0,
        ...(cancel ? {pendingCancel:{requestedAtTs:1,cancelEffectiveTs:2}} : {}),
      }]}}});
}
describe("checkpoint-bound pending modeled orders",()=>{
  it("allows only public modeled order fields",()=>{
    expect(projectHistoricalPendingOrdersV2(fixture(),scope)).toEqual([{orderId:"order",symbol:"BTCUSDT",side:"buy",
      state:"ACCEPTED",quantity:"1",filledQuantity:"0",remainingQuantity:"1",cancellationPending:false}]);
  });
  it("preserves partial fill and cancellation pending separately",()=>{
    expect(projectHistoricalPendingOrdersV2(fixture({state:"PARTIALLY_FILLED",filledQuantity:"0.4"},"0.6",true),scope)[0])
      .toMatchObject({state:"PARTIALLY_FILLED",filledQuantity:"0.4",remainingQuantity:"0.6",cancellationPending:true});
  });
  it.each([{historicalRunId:"other"},{historicalAccountKey:"other"},{executionMode:"live" as const},
    {credentialId:"forbidden"},{state:"FILLED" as const}])("refuses invalid scoped/mode state %j",overrides=>{
    expect(()=>projectHistoricalPendingOrdersV2(fixture(overrides),scope)).toThrow("PENDING_ORDER_INVALID");
  });
  it("refuses inconsistent quantity and changed scope",()=>{
    expect(()=>projectHistoricalPendingOrdersV2(fixture({},"0.5"),scope)).toThrow("PENDING_ORDER_INVALID");
    expect(()=>projectHistoricalPendingOrdersV2(fixture(),{...scope,accountId:"other"})).toThrow();
  });
  it("refuses a tampered immutable snapshot",()=>{
    const snapshot=JSON.parse(JSON.stringify(fixture()));snapshot.state.openOrders[0].quantity="9";
    expect(()=>projectHistoricalPendingOrdersV2(snapshot,scope)).toThrow();
  });
});
