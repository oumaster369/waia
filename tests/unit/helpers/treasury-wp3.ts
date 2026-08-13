import { USDT_TRC20_CONTRACT } from "@/lib/waia-core/payment-watcher/watcher-config";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { AuditLogInput } from "@/lib/waia-core/types";
import { createMemoryTreasuryDomainServices } from "@/lib/waia-core/treasury";
import type { TreasuryChainAdapter } from "@/lib/waia-core/treasury/watcher/chain-adapter.port";
import {
  loadTreasuryWatcherConfig,
  TREASURY_WATCHER_CHECKPOINT_KEY,
  type TreasuryWatcherConfig,
} from "@/lib/waia-core/treasury/watcher/config";
import { runTreasuryWatcherCycle } from "@/lib/waia-core/treasury/watcher/cycle";
import { createSilentTreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
import { createMemoryTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/memory-repository";
import type { TreasuryObservedTransfer } from "@/lib/waia-core/treasury/watcher/types";
import { ORG_A, ORG_B, USER_A, actorA, ctxA, ctxB } from "@/tests/unit/helpers/treasury-wp2";

export { ORG_A, ORG_B, USER_A, actorA, ctxA, ctxB, TREASURY_WATCHER_CHECKPOINT_KEY };

export const ADDR_A = "TManagedAAAA";
export const ADDR_B = "TManagedBBBB";
export const ADDR_EXT = "TExternalCCCC";
export const ADDR_EXT_2 = "TExternalDDDD";
export const WATCHED_A = "waaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const WATCHED_B = "wbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const INCEPTION_A = "iaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const HUGE_ATOMIC = 9_007_199_254_740_993n;

export type FakeChainState = {
  chainCalls: number;
  tip: string;
  transfersByBlock: Record<string, TreasuryObservedTransfer[]>;
  exists: Record<string, boolean>;
  tipError?: string;
  blockErrors: Record<string, string>;
  existsError?: string;
  historicalBalance?: bigint | null;
};

export function watcherConfig(
  overrides: Partial<TreasuryWatcherConfig> = {},
): TreasuryWatcherConfig {
  return {
    ...loadTreasuryWatcherConfig({ TREASURY_WATCHER_ENABLED: "true" }),
    confirmationsRequired: 3,
    rescanWindow: 10,
    maxBlocksPerCycle: 20,
    reorgAgeoutMinutes: 30,
    tokenContract: USDT_TRC20_CONTRACT,
    ...overrides,
  };
}

export function transfer(input: {
  txHash: string;
  from: string;
  to: string;
  block: string;
  amount?: bigint;
  index?: number;
}): TreasuryObservedTransfer {
  return {
    txHash: input.txHash,
    transferIndex: input.index ?? 0,
    fromAddress: input.from,
    toAddress: input.to,
    tokenContract: USDT_TRC20_CONTRACT,
    nativeAmountAtomic: input.amount ?? 1_000_000n,
    blockHeight: input.block,
    blockTimestamp: new Date("2026-08-13T00:00:00.000Z"),
  };
}

export function createFakeChainAdapter(input?: {
  tip?: string;
  transfersByBlock?: Record<string, TreasuryObservedTransfer[]>;
  exists?: Record<string, boolean>;
  tipError?: string;
  blockErrors?: Record<string, string>;
  existsError?: string;
  historicalBalance?: bigint | null;
  omitBalanceCapability?: boolean;
}): TreasuryChainAdapter & { chainCalls: number; state: FakeChainState } {
  const state: FakeChainState = {
    chainCalls: 0,
    tip: input?.tip ?? "110",
    transfersByBlock: input?.transfersByBlock ?? {},
    exists: input?.exists ?? {},
    tipError: input?.tipError,
    blockErrors: input?.blockErrors ?? {},
    existsError: input?.existsError,
    historicalBalance: input?.historicalBalance,
  };
  const adapter: TreasuryChainAdapter & { chainCalls: number; state: FakeChainState } = {
    state,
    get chainCalls() {
      return state.chainCalls;
    },
    async getTipBlock() {
      state.chainCalls += 1;
      if (state.tipError) return { ok: false, error: state.tipError, provider: "primary" };
      return { ok: true, value: state.tip, provider: "primary" };
    },
    async getTransfersForBlock(blockNumber) {
      state.chainCalls += 1;
      if (state.blockErrors[blockNumber]) {
        return { ok: false, error: state.blockErrors[blockNumber], provider: "primary" };
      }
      return { ok: true, value: state.transfersByBlock[blockNumber] ?? [], provider: "primary" };
    },
    async getTransactionExists(txHash) {
      state.chainCalls += 1;
      if (state.existsError) return { ok: false, error: state.existsError, provider: "primary" };
      if (txHash in state.exists) {
        return { ok: true, value: state.exists[txHash]!, provider: "primary" };
      }
      return { ok: true, value: true, provider: "primary" };
    },
  };
  if (!input?.omitBalanceCapability) {
    adapter.getConsolidatedBalanceAtBlock = async () => {
      state.chainCalls += 1;
      if (state.historicalBalance === null || state.historicalBalance === undefined) {
        return { ok: true, value: { supported: false }, provider: "primary" };
      }
      return {
        ok: true,
        value: { supported: true, atomic: state.historicalBalance },
        provider: "primary",
      };
    };
  }
  return adapter;
}

export async function createWatcherHarness(input?: {
  enabled?: boolean;
  config?: Partial<TreasuryWatcherConfig>;
  chain?: ReturnType<typeof createFakeChainAdapter>;
  seedOrgB?: boolean;
  skipInception?: boolean;
  now?: Date;
}) {
  const audits: AuditLogInput[] = [];
  const services = createMemoryTreasuryDomainServices(async (row) => {
    audits.push(row);
    return `audit-${audits.length}`;
  });
  const verifyCalls: unknown[][] = [];
  const originalVerify = services.transactions.verify.bind(services.transactions);
  services.transactions.verify = async (...args) => {
    verifyCalls.push(args);
    return originalVerify(...args);
  };
  const watcherRepository = createMemoryTreasuryWatcherRepository(services.repository);
  const now = input?.now ?? new Date("2026-08-13T12:00:00.000Z");
  if (!input?.skipInception) {
    await services.repository.insertInception({
      id: INCEPTION_A,
      organizationId: ORG_A,
      network: "TRC-20",
      tokenContract: USDT_TRC20_CONTRACT,
      assetCode: "USDT",
      inceptionBlock: "99",
      inceptionBlockHash: null,
      inceptionTime: now,
      openingBalanceTransactionId: "00000000-0000-4000-8000-000000000099",
      watcherStartBlock: "100",
      evidenceObjectId: null,
      status: "ACTIVE",
      createdByUserId: USER_A,
      approvedByUserId: USER_A,
      createdAt: now,
    });
  }
  await watcherRepository.insertWatchedAddress({
    id: WATCHED_A,
    organizationId: ORG_A,
    network: "TRC-20",
    address: ADDR_A,
    tokenContract: USDT_TRC20_CONTRACT,
    assetCode: "USDT",
    directionScope: "BOTH",
    includeInBalanceRecon: true,
    label: "A",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await watcherRepository.insertWatchedAddress({
    id: WATCHED_B,
    organizationId: ORG_A,
    network: "TRC-20",
    address: ADDR_B,
    tokenContract: USDT_TRC20_CONTRACT,
    assetCode: "USDT",
    directionScope: "BOTH",
    includeInBalanceRecon: true,
    label: "B",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  if (input?.seedOrgB) {
    await watcherRepository.insertWatchedAddress({
      id: "wbbbbbbb-bbbb-4bbb-8bbb-orgb00000001",
      organizationId: ORG_B,
      network: "TRC-20",
      address: ADDR_EXT,
      tokenContract: USDT_TRC20_CONTRACT,
      assetCode: "USDT",
      directionScope: "BOTH",
      includeInBalanceRecon: true,
      label: "B-org",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  const config = watcherConfig({
    enabled: input?.enabled ?? true,
    ...input?.config,
  });
  const chain = input?.chain ?? createFakeChainAdapter();
  const logs: unknown[] = [];
  const lifecyclePatches: Array<{ observationId: string; patch: Record<string, unknown> }> = [];
  const originalLifecycle = watcherRepository.updateObservationLifecycle.bind(watcherRepository);
  watcherRepository.updateObservationLifecycle = async (context, observationId, patch) => {
    lifecyclePatches.push({ observationId, patch: { ...patch } });
    return originalLifecycle(context, observationId, patch);
  };
  async function run(context: OrgContext = ctxA, at: Date = now) {
    return runTreasuryWatcherCycle(context, {
      config,
      chainAdapter: chain,
      watcherRepository,
      treasuryRepository: services.repository,
      transactions: services.transactions,
      logger: {
        log(payload) {
          logs.push(payload);
        },
      },
      now: () => at,
    });
  }
  return {
    services,
    watcherRepository,
    config,
    chain,
    audits,
    logs,
    now,
    run,
    verifyCalls,
    lifecyclePatches,
    silent: createSilentTreasuryWatcherLogger(),
  };
}

export { requireOrgContext, USDT_TRC20_CONTRACT };
