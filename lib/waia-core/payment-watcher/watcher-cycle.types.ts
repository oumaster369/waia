import type { PaymentAddressInboundResolver } from "@/lib/waia-core/payment-addresses/payment-address-inbound-resolver.port";
import type { PaymentService } from "@/lib/waia-core/payments/payment-service";
import type { WatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
import type { WatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";
import type { ChainAdapter } from "@/lib/waia-core/payment-watcher/chain-adapter.port";
import type { WatcherLogger } from "@/lib/waia-core/payment-watcher/watcher-logger";

/** Normalized on-chain transfer observed by the watcher. */
export type ObservedTransfer = {
  txHash: string;
  transferIndex: number;
  toAddress: string;
  fromAddress: string;
  contractAddress: string;
  amountRaw: string;
  amountDecimal: string;
  blockHeight: string;
  blockTimestamp: Date;
  confirmationsObserved: number;
};

export type CycleOutcome =
  | "success"
  | "noop_disabled"
  | "noop_lease_held"
  | "noop_provider_error"
  | "error";

export type CycleReport = {
  network: string;
  outcome: CycleOutcome;
  tipBlock: string | null;
  fromBlock: string | null;
  toBlock: string | null;
  detected: number;
  confirmed: number;
  failed: number;
  skipped: number;
  provider: "primary" | "secondary" | null;
  durationMs: number;
  errorMessage: string | null;
};

export type WatcherDeps = {
  config: WatcherConfig;
  chainAdapter: ChainAdapter;
  checkpointRepository: WatcherCheckpointRepository;
  paymentService: PaymentService;
  inboundResolver: PaymentAddressInboundResolver;
  logger: WatcherLogger;
  /** Global service-role query for DETECTED inbound watcher payments (reorg age-out). */
  listDetectedInboundPayments: () => Promise<
    Array<{ paymentId: string; organizationId: string; idempotencyKey: string; createdAt: Date }>
  >;
  now?: () => Date;
};
