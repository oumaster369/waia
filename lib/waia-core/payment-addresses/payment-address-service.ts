import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import {
  paymentAddressAuditActions,
  paymentAddressEntityTypes,
} from "@/lib/waia-core/payment-addresses/payment-address.audit";
import {
  AddressAlreadyAssignedError,
  AddressNotFoundError,
} from "@/lib/waia-core/payment-addresses/payment-address.errors";
import type { PaymentAddressEventsRepository } from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";
import type {
  PaymentAddressEventDigestInput,
  PaymentAddressEventRecordView,
  PaymentAddressEventType,
  PaymentAddressSubjectModule,
  PaymentWalletView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import { assertAddressTransitionAllowed } from "@/lib/waia-core/payment-addresses/payment-address-lifecycle.transitions";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";
import type {
  ListPaymentAddressesQuery,
  PaymentAddressProjectionRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";
import {
  createPostgresPaymentAddressEventsRepository,
  createPostgresPaymentAddressProjectionRepository,
  createPostgresPaymentWalletRepository,
  createSqlitePaymentAddressEventsRepository,
  createSqlitePaymentAddressProjectionRepository,
  createSqlitePaymentWalletRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-repository-adapters";
import type {
  CreatePaymentWalletInput,
  PaymentWalletRepository,
} from "@/lib/waia-core/payment-addresses/payment-wallet-repository.types";
import { foldPaymentAddressEventsToProjection } from "@/lib/waia-core/payment-addresses/rebuild-payment-address-projection";
import { buildPaymentAddressEventRecordPayload } from "@/lib/waia-core/payment-addresses/serialize-payment-address-events";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";
import type { AuditLogInput } from "@/lib/waia-core/types";

export type GenerateAddressInput = {
  walletId: string;
  network: string;
  address: string;
  reason?: string | null;
};

export type AssignAddressInput = {
  addressId: string;
  subjectModule: PaymentAddressSubjectModule;
  subjectRef: string;
  bindingRef?: string | null;
  reason?: string | null;
};

export type AddressTransitionInput = {
  addressId: string;
  reason?: string | null;
};

export type PaymentAddressServiceDeps = {
  eventsRepository: PaymentAddressEventsRepository;
  projectionRepository: PaymentAddressProjectionRepository;
  walletRepository: PaymentWalletRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
  runAtomic?: <T>(fn: (deps: PaymentAddressServiceDeps) => Promise<T>) => Promise<T>;
};

export type PaymentAddressService = {
  createWallet(context: OrgContext, input: CreatePaymentWalletInput): Promise<PaymentWalletView>;
  generateAddress(
    context: OrgContext,
    input: GenerateAddressInput,
  ): Promise<PaymentAddressProjectionView>;
  reserveAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  releaseAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  assignAddress(
    context: OrgContext,
    input: AssignAddressInput,
  ): Promise<PaymentAddressProjectionView>;
  activateAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  rotateAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  retireAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  archiveAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  recoverAddress(
    context: OrgContext,
    input: AddressTransitionInput,
  ): Promise<PaymentAddressProjectionView>;
  getAddress(context: OrgContext, addressId: string): Promise<PaymentAddressProjectionView | null>;
  listAddresses(
    context: OrgContext,
    query?: ListPaymentAddressesQuery,
  ): Promise<PaymentAddressProjectionView[]>;
  rebuildAddressProjection(
    context: OrgContext,
    addressId: string,
  ): Promise<PaymentAddressProjectionView>;
};

const ASSIGNED_STATUSES = new Set<PaymentAddressProjectionView["status"]>([
  "ASSIGNED",
  "ACTIVATED",
  "ROTATED",
  "RETIRED",
  "ARCHIVED",
  "RECOVERED",
]);

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: PaymentAddressServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAddressAuditInput(
  action: AuditLogInput["action"],
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
): AuditLogInput {
  return {
    actorType: "service",
    actorId: null,
    action,
    entityType: paymentAddressEntityTypes.paymentAddress,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

async function appendAddressEventAndProjection(
  deps: PaymentAddressServiceDeps,
  context: OrgContext,
  auditAction: AuditLogInput["action"],
  payloadInput: PaymentAddressEventDigestInput,
): Promise<{ event: PaymentAddressEventRecordView; projection: PaymentAddressProjectionView }> {
  const payload = buildPaymentAddressEventRecordPayload(payloadInput);
  const event = await deps.eventsRepository.insertEvent(context, { payload });
  const events = await deps.eventsRepository.listEventsForAddress(context, payload.addressId);
  const projection = foldPaymentAddressEventsToProjection(events);
  if (!projection) {
    throw new Error("[waia-core] payment address projection fold failed");
  }
  const savedProjection = await deps.projectionRepository.upsertProjection(context, projection);
  await deps.writeAudit(
    buildAddressAuditInput(auditAction, context, payload.addressId, {
      addressId: payload.addressId,
      eventId: event.id,
      eventType: payload.eventType,
      seq: payload.seq,
      recordContentDigest: payload.recordContentDigest,
    }),
  );
  return { event, projection: savedProjection };
}

function buildTransitionPayload(
  current: PaymentAddressProjectionView,
  eventType: PaymentAddressEventType,
  reason: string | null,
  binding?: {
    subjectModule: PaymentAddressSubjectModule | null;
    subjectRef: string | null;
    bindingRef: string | null;
  },
): PaymentAddressEventDigestInput {
  const bindingFields = binding ?? {
    subjectModule: current.subjectModule,
    subjectRef: current.subjectRef,
    bindingRef: current.bindingRef,
  };

  return {
    organizationId: current.organizationId,
    addressId: current.addressId,
    walletId: current.walletId,
    seq: current.lastEventSeq + 1,
    eventType,
    network: current.network,
    address: null,
    subjectModule: bindingFields.subjectModule,
    subjectRef: bindingFields.subjectRef,
    bindingRef: bindingFields.bindingRef,
    reason,
    prevEventDigest: current.lastEventDigest,
  };
}

async function transitionAddress(
  deps: PaymentAddressServiceDeps,
  scoped: OrgContext,
  addressId: string,
  eventType: PaymentAddressEventType,
  auditAction: AuditLogInput["action"],
  reason: string | null,
  binding?: {
    subjectModule: PaymentAddressSubjectModule | null;
    subjectRef: string | null;
    bindingRef: string | null;
  },
): Promise<PaymentAddressProjectionView> {
  const current = await deps.projectionRepository.getByAddressId(scoped, addressId);
  if (!current) {
    throw new AddressNotFoundError(addressId);
  }

  assertAddressTransitionAllowed(addressId, current.status, eventType);

  const runAtomic =
    deps.runAtomic ??
    (async <T>(fn: (atomicDeps: PaymentAddressServiceDeps) => Promise<T>) => fn(deps));

  return runAtomic(async (atomicDeps) =>
    appendAddressEventAndProjection(
      atomicDeps,
      scoped,
      auditAction,
      buildTransitionPayload(current, eventType, reason, binding),
    ).then(({ projection }) => projection),
  );
}

export function createPaymentAddressService(
  deps: PaymentAddressServiceDeps,
): PaymentAddressService {
  const runAtomic =
    deps.runAtomic ??
    (async <T>(fn: (atomicDeps: PaymentAddressServiceDeps) => Promise<T>) => fn(deps));

  return {
    async createWallet(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      return runAtomic(async (atomicDeps) => {
        const wallet = await atomicDeps.walletRepository.createWallet(scoped, input);
        await atomicDeps.writeAudit({
          actorType: "service",
          actorId: null,
          action: paymentAddressAuditActions.walletCreated,
          entityType: paymentAddressEntityTypes.paymentWallet,
          entityId: wallet.id,
          organizationId: scoped.organizationId,
          metadata: {
            walletId: wallet.id,
            walletKind: wallet.walletKind,
            custodyModel: wallet.custodyModel,
          },
        });
        return wallet;
      });
    },

    async generateAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const wallet = await deps.walletRepository.getWalletById(scoped, input.walletId);
      if (!wallet) {
        throw new Error("[waia-core] payment wallet not found for organization");
      }

      const existing = await deps.projectionRepository.getByNetworkAddress(
        scoped,
        input.network,
        input.address,
      );
      if (existing) {
        return existing;
      }

      const addressId = crypto.randomUUID();

      return runAtomic(async (atomicDeps) =>
        appendAddressEventAndProjection(
          atomicDeps,
          scoped,
          paymentAddressAuditActions.addressGenerated,
          {
            organizationId: scoped.organizationId,
            addressId,
            walletId: input.walletId,
            seq: 1,
            eventType: "GENERATED",
            network: input.network,
            address: input.address,
            subjectModule: null,
            subjectRef: null,
            bindingRef: null,
            reason: input.reason ?? null,
            prevEventDigest: null,
          },
        ).then(({ projection }) => projection),
      );
    },

    async reserveAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "RESERVED",
        paymentAddressAuditActions.addressReserved,
        input.reason ?? null,
      );
    },

    async releaseAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "RELEASED",
        paymentAddressAuditActions.addressReleased,
        input.reason ?? null,
      );
    },

    async assignAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const current = await deps.projectionRepository.getByAddressId(scoped, input.addressId);
      if (!current) {
        throw new AddressNotFoundError(input.addressId);
      }
      if (ASSIGNED_STATUSES.has(current.status)) {
        throw new AddressAlreadyAssignedError(input.addressId);
      }

      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "ASSIGNED",
        paymentAddressAuditActions.addressAssigned,
        input.reason ?? null,
        {
          subjectModule: input.subjectModule,
          subjectRef: input.subjectRef,
          bindingRef: input.bindingRef ?? null,
        },
      );
    },

    async activateAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const current = await deps.projectionRepository.getByAddressId(scoped, input.addressId);
      if (!current) {
        throw new AddressNotFoundError(input.addressId);
      }

      if (current.subjectModule && current.subjectRef) {
        const existing = await deps.projectionRepository.findActiveBySubject(
          scoped,
          current.subjectModule,
          current.subjectRef,
        );
        if (existing && existing.addressId !== input.addressId) {
          throw new AddressAlreadyAssignedError(existing.addressId);
        }
      }

      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "ACTIVATED",
        paymentAddressAuditActions.addressActivated,
        input.reason ?? null,
      );
    },

    async rotateAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "ROTATED",
        paymentAddressAuditActions.addressRotated,
        input.reason ?? null,
      );
    },

    async retireAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "RETIRED",
        paymentAddressAuditActions.addressRetired,
        input.reason ?? null,
      );
    },

    async archiveAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "ARCHIVED",
        paymentAddressAuditActions.addressArchived,
        input.reason ?? null,
      );
    },

    async recoverAddress(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return transitionAddress(
        deps,
        scoped,
        input.addressId,
        "RECOVERED",
        paymentAddressAuditActions.addressRecovered,
        input.reason ?? null,
      );
    },

    async getAddress(context, addressId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.projectionRepository.getByAddressId(scoped, addressId);
    },

    async listAddresses(context, query) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.projectionRepository.listAddresses(scoped, query);
    },

    async rebuildAddressProjection(context, addressId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const events = await deps.eventsRepository.listEventsForAddress(scoped, addressId);
      if (events.length === 0) {
        throw new AddressNotFoundError(addressId);
      }

      const projection = foldPaymentAddressEventsToProjection(events);
      if (!projection) {
        throw new Error("[waia-core] payment address projection rebuild failed");
      }

      return deps.projectionRepository.upsertProjection(scoped, projection);
    },
  };
}

type PgPaymentAddressExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

function buildSqlitePaymentAddressServiceDeps(
  db: WaiaDb,
  overrides: Partial<PaymentAddressServiceDeps> = {},
): PaymentAddressServiceDeps {
  return {
    eventsRepository: overrides.eventsRepository ?? createSqlitePaymentAddressEventsRepository(db),
    projectionRepository:
      overrides.projectionRepository ?? createSqlitePaymentAddressProjectionRepository(db),
    walletRepository: overrides.walletRepository ?? createSqlitePaymentWalletRepository(db),
    writeAudit: overrides.writeAudit ?? ((input) => writeAuditLogSqlite(db, input)),
    assertMembership:
      overrides.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  };
}

export function createSqlitePaymentAddressService(
  db: WaiaDb,
  overrides: Partial<PaymentAddressServiceDeps> = {},
): PaymentAddressService {
  return createPaymentAddressService({
    ...buildSqlitePaymentAddressServiceDeps(db, overrides),
    runAtomic: async (fn) => fn(buildSqlitePaymentAddressServiceDeps(db, overrides)),
  });
}

export function createPostgresPaymentAddressService(
  ex: PgPaymentAddressExecutor,
  overrides: Partial<PaymentAddressServiceDeps> = {},
  db?: WaiaPostgresDb,
): PaymentAddressService {
  const buildPostgresDeps = (executor: PgPaymentAddressExecutor): PaymentAddressServiceDeps => ({
    eventsRepository:
      overrides.eventsRepository ?? createPostgresPaymentAddressEventsRepository(executor),
    projectionRepository:
      overrides.projectionRepository ?? createPostgresPaymentAddressProjectionRepository(executor),
    walletRepository: overrides.walletRepository ?? createPostgresPaymentWalletRepository(executor),
    writeAudit: overrides.writeAudit ?? ((input) => writeAuditLogPostgres(executor, input)),
    assertMembership:
      overrides.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(executor, context);
      }),
  });

  return createPaymentAddressService({
    ...buildPostgresDeps(ex),
    runAtomic: async (fn) => {
      if (!db) {
        return fn(buildPostgresDeps(ex));
      }
      return runWaiaPostgresTransaction(db, (tx) => fn(buildPostgresDeps(tx)));
    },
  });
}
