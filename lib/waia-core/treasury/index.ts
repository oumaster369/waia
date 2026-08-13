import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import type { AuditLogInput } from "@/lib/waia-core/types";
import { createTreasuryCommitmentService } from "@/lib/waia-core/treasury/commitment-service";
import { createTreasuryInceptionService } from "@/lib/waia-core/treasury/inception-service";
import { createMemoryTreasuryRepository } from "@/lib/waia-core/treasury/memory-repository";
import { createPostgresTreasuryRepository } from "@/lib/waia-core/treasury/postgres-repository";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import { createTreasuryTransactionService } from "@/lib/waia-core/treasury/transaction-service";

export {
  USDT_NOMINAL_USD_POLICY_V1,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
  TREASURY_USDT_V1_NETWORK,
} from "@/lib/waia-core/treasury/types";
export type {
  TreasuryActorContext,
  TreasuryAttributionRecord,
  TreasuryCommitmentRecord,
  TreasuryInceptionRecord,
  TreasuryObservationRecord,
  TreasuryTransactionRecord,
  TreasuryTxDirection,
  TreasuryTxKind,
  TreasuryTxStatus,
  TreasuryDetailPublication,
  TreasuryCommitmentStatus,
  TreasuryProvenance,
} from "@/lib/waia-core/treasury/types";

export {
  IllegalTreasuryTransitionError,
  TreasuryNotFoundError,
  TreasuryValidationError,
  TreasuryOrgScopeError,
} from "@/lib/waia-core/treasury/errors";

export {
  computeCanonicalCashEffect,
  assertCashEffectMatches,
} from "@/lib/waia-core/treasury/cash-effect";
export {
  assertTreasuryTxTransitionAllowed,
  isTerminalTreasuryTxStatus,
  isTreasuryTxTransitionAllowed,
  allowedTreasuryTxTransitions,
  TREASURY_TX_STATUSES,
} from "@/lib/waia-core/treasury/transaction-fsm";
export {
  assertTreasuryCommitmentTransitionAllowed,
  isActiveCommittedStatus,
  isTreasuryCommitmentTransitionAllowed,
  TREASURY_COMMITMENT_STATUSES,
} from "@/lib/waia-core/treasury/commitment-fsm";
export { applyDetailPublicationChange } from "@/lib/waia-core/treasury/publication";
export {
  assertWatcherVerifiedPrecondition,
  observationSatisfiesVerifiedPrecondition,
} from "@/lib/waia-core/treasury/watcher-verify-precondition";
export {
  isQualifyingContribution,
  netQualifyingMicros,
  computeContributionShareTotals,
  contributionShareOrZero,
} from "@/lib/waia-core/treasury/contribution-share";
export { accountingMicrosFromUsdtNominal, requireBigint } from "@/lib/waia-core/treasury/money";
export { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
export { createTreasuryTransactionService } from "@/lib/waia-core/treasury/transaction-service";
export {
  createTreasuryCommitmentService,
  deriveActiveCommittedFundsMicros,
} from "@/lib/waia-core/treasury/commitment-service";
export { createTreasuryInceptionService } from "@/lib/waia-core/treasury/inception-service";
export { createMemoryTreasuryRepository } from "@/lib/waia-core/treasury/memory-repository";
export { createPostgresTreasuryRepository } from "@/lib/waia-core/treasury/postgres-repository";

export type TreasuryDomainServices = {
  transactions: ReturnType<typeof createTreasuryTransactionService>;
  commitments: ReturnType<typeof createTreasuryCommitmentService>;
  inceptions: ReturnType<typeof createTreasuryInceptionService>;
  repository: TreasuryRepository;
};

function buildServices(
  repository: TreasuryRepository,
  writeAudit: (input: AuditLogInput) => string | Promise<string>,
  runAtomic: <T>(
    fn: (bound: { repository: TreasuryRepository; writeAudit: typeof writeAudit }) => Promise<T>,
  ) => Promise<T>,
): TreasuryDomainServices {
  const shared = { repository, writeAudit, runAtomic };
  return {
    repository,
    transactions: createTreasuryTransactionService(shared),
    commitments: createTreasuryCommitmentService(shared),
    inceptions: createTreasuryInceptionService(shared),
  };
}

export function createMemoryTreasuryDomainServices(
  writeAudit: (input: AuditLogInput) => string | Promise<string> = async () => "audit-id",
): TreasuryDomainServices {
  const repository = createMemoryTreasuryRepository();
  return buildServices(repository, writeAudit, async (fn) => fn({ repository, writeAudit }));
}

export function createPostgresTreasuryDomainServices(db: WaiaPostgresDb): TreasuryDomainServices {
  const repository = createPostgresTreasuryRepository(db);
  const writeAudit = (input: AuditLogInput) => writeAuditLogPostgres(db, input);
  return buildServices(repository, writeAudit, async (fn) =>
    runWaiaPostgresTransaction(db, async (tx) =>
      fn({
        repository: createPostgresTreasuryRepository(tx),
        writeAudit: (input) => writeAuditLogPostgres(tx, input),
      }),
    ),
  );
}
