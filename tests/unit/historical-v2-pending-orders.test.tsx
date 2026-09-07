import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HistoricalV2PendingOrders } from "@/components/trader/historical-v2-pending-orders";
const order={orderId:"modeled-1",symbol:"BTCUSDT",side:"buy" as const,state:"ACCEPTED",quantity:"1",
  filledQuantity:"0",remainingQuantity:"1",cancellationPending:false};
const account={accountId:"a",cycleSequence:79,pendingModeledOrders:[order]};
afterEach(cleanup);
describe("historical pending-order view",()=>{
  it("distinguishes completed replay from unsettled execution",()=>{
    render(<HistoricalV2PendingOrders accounts={[account]} replayCompleted/>);
    expect(screen.getByRole("status").textContent).toContain("completed with unsettled modeled orders");
    expect(screen.getByText(/BTCUSDT · BUY · ACCEPTED/)).toBeTruthy();
    expect(screen.getByText(/Filled 0 · Remaining 1/)).toBeTruthy();
  });
  it("shows pending cancellation without claiming cancellation completed",()=>{
    render(<HistoricalV2PendingOrders accounts={[{...account,pendingModeledOrders:[{...order,cancellationPending:true}]}]} replayCompleted={false}/>);
    expect(screen.getByText("Cancellation pending — not yet cancelled.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("shows empty verified state without implying all positions are closed",()=>{
    render(<HistoricalV2PendingOrders accounts={[{...account,pendingModeledOrders:[]}]} replayCompleted/>);
    expect(screen.getByText("No pending modeled orders at this checkpoint.")).toBeTruthy();
  });
  it("does not turn an old cached projection into a false empty state",()=>{
    render(<HistoricalV2PendingOrders accounts={[{...account,pendingModeledOrders:undefined as never}]} replayCompleted/>);
    expect(screen.getByRole("status").textContent).toContain("Settlement cannot be confirmed");
    expect(screen.queryByText("No pending modeled orders at this checkpoint.")).toBeNull();
  });
});
