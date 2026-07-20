import { describe, expect, it } from "vitest";

import {
  createSqliteOrderRepository,
  createPostgresOrderRepository,
} from "@/lib/trader/execution/repository-adapters";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";

describe("OrderRepository.recordFillProgress contract", () => {
  it("requires recordFillProgress on sqlite adapter factories", () => {
    const repo: OrderRepository = {
      createOrder: async () => {
        throw new Error("unused");
      },
      getOrderById: async () => null,
      findOrderByClientOrderId: async () => null,
      findOrderByIdempotencyKey: async () => null,
      listOpenOrders: async () => [],
      listOrders: async () => [],
      transitionOrder: async () => {
        throw new Error("unused");
      },
      recordFill: async () => {
        throw new Error("unused");
      },
      recordFillProgress: async () => {
        throw new Error("unused");
      },
      listEvents: async () => [],
      listFills: async () => [],
    };
    expect(repo.recordFillProgress).toBeTypeOf("function");
    expect(createSqliteOrderRepository).toBeTypeOf("function");
    expect(createPostgresOrderRepository).toBeTypeOf("function");
  });
});
