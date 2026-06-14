import { describe, expect, it } from "vitest";

import { mapConnectorStatusToOrderState } from "@/lib/trader/execution/connector-status-map";

describe("connector status map (DEE-247)", () => {
  it("maps open to ACCEPTED", () => {
    expect(mapConnectorStatusToOrderState("open")).toBe("ACCEPTED");
  });

  it("maps partially_filled to PARTIALLY_FILLED", () => {
    expect(mapConnectorStatusToOrderState("partially_filled")).toBe("PARTIALLY_FILLED");
  });

  it("maps filled to FILLED", () => {
    expect(mapConnectorStatusToOrderState("filled")).toBe("FILLED");
  });

  it("maps canceled to CANCELLED", () => {
    expect(mapConnectorStatusToOrderState("canceled")).toBe("CANCELLED");
  });

  it("maps rejected to REJECTED", () => {
    expect(mapConnectorStatusToOrderState("rejected")).toBe("REJECTED");
  });
});
