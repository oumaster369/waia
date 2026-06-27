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
  AddressNotFoundError,
  AddressOrgOwnershipMismatchError,
  isAddressActiveForAttribution,
} from "@/lib/waia-core/payment-addresses";
import type { PaymentAddressAttributionReader } from "@/lib/waia-core/payments/payment-address-attribution.port";
import {
  createPostgresPaymentAddressAttributionReader,
  createSqlitePaymentAddressAttributionReader,
} from "@/lib/waia-core/payments/payment-address-attribution.port";
import {
  PaymentAddressNotAttributableError,
  PaymentAttributionRequiredError,
  PaymentNotFoundError,
  PaymentSettlementAlreadyAttributedError,
} from "@/lib/waia-core/payments/payment.errors";
import type { PaymentEventsRepository } from "@/lib/waia-core/payments/payment-events-repository.types";
import type {
  PaymentDirection,
  PaymentEventRecordView,
  PaymentFailureReason,
  PaymentSubjectModule,
  SettlementEvidence,
} from "@/lib/waia-core/payments/payment-events.types";
import { assertPaymentTransitionAllowed } from "@/lib/waia-core/payments/payment-lifecycle.transitions";
import type { PaymentProjectionView } from "@/lib/waia-core/payments/payment-projection.types";
import {
  createPostgresPaymentEventsRepository,
  createPostgresPaymentsProjectionRepository,
  createSqlitePaymentEventsRepository,
  createSqlitePaymentsProjectionRepository,
} from "@/lib/waia-core/payments/payment-repository-adapters";
import type {
  ListPaymentsQuery,
  PaymentsProjectionRepository,
} from "@/lib/waia-core/payments/payments-projection-repository.types";
import { foldPaymentEventsToProjection } from "@/lib/waia-core/payments/rebuild-payment-projection";
import { buildPaymentEventRecordPayload } from "@/lib/waia-core/payments/serialize-payment-events";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";
import { paymentAuditActions, paymentEntityTypes, type AuditLogInput } from "@/lib/waia-core/types";

export type DetectPaymentInput = {
  idempotencyKey: string;
  subjectModule: PaymentSubjectModule;
  subjectInvoiceId?: string | null;
  paymentAddressId?: string | null;
  direction?: PaymentDirection;
};

export type ConfirmPaymentInput = {
  paymentId: string;
  settlement: SettlementEvidence;
  subjectInvoiceId?: string | null;
  paymentAddressId?: string | null;
};

export type FailPaymentInput = {
  paymentId: string;
  reason: PaymentFailureReason;
};

export type PaymentServiceDeps = {
  eventsRepository: PaymentEventsRepository;
  projectionRepository: PaymentsProjectionRepository;
  addressAttributionReader?: PaymentAddressAttributionReader;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
  runAtomic?: <T>(fn: (deps: PaymentServiceDeps) => Promise<T>) => Promise<T>;
};

export type PaymentService = {
  detectPayment(context: OrgContext, input: DetectPaymentInput): Promise<PaymentProjectionView>;
  confirmPayment(context: OrgContext, input: ConfirmPaymentInput): Promise<PaymentProjectionView>;
  failPayment(context: OrgContext, input: FailPaymentInput): Promise<PaymentProjectionView>;
  getPayment(context: OrgContext, paymentId: string): Promise<PaymentProjectionView | null>;
  listPayments(context: OrgContext, query?: ListPaymentsQuery): Promise<PaymentProjectionView[]>;
  rebuildProjection(context: OrgContext, paymentId: string): Promise<PaymentProjectionView>;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: PaymentServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildPaymentAuditInput(
  action: AuditLogInput["action"],
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
): AuditLogInput {
  return {
    actorType: "service",
    actorId: null,
    action,
    entityType: paymentEntityTypes.payment,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function hasAttribution(
  subjectInvoiceId: string | null | undefined,
  paymentAddressId: string | null | undefined,
): boolean {
  return Boolean(subjectInvoiceId?.trim() || paymentAddressId?.trim());
}

async function appendEventAndProjection(
  deps: PaymentServiceDeps,
  context: OrgContext,
  auditAction: AuditLogInput["action"],
  payloadInput: Parameters<typeof buildPaymentEventRecordPayload>[0],
  extraMetadata?: Record<string, unknown>,
): Promise<{ event: PaymentEventRecordView; projection: PaymentProjectionView }> {
  const payload = buildPaymentEventRecordPayload(payloadInput);
  const event = await deps.eventsRepository.insertEvent(context, { payload });
  const events = await deps.eventsRepository.listEventsForPayment(context, payload.paymentId);
  const projection = foldPaymentEventsToProjection(events);
  if (!projection) {
    throw new Error("[waia-core] payment projection fold failed");
  }
  const savedProjection = await deps.projectionRepository.upsertProjection(context, projection);
  await deps.writeAudit(
    buildPaymentAuditInput(auditAction, context, payload.paymentId, {
      paymentId: payload.paymentId,
      eventId: event.id,
      eventType: payload.eventType,
      seq: payload.seq,
      recordContentDigest: payload.recordContentDigest,
      ...extraMetadata,
    }),
  );
  return { event, projection: savedProjection };
}

export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const runAtomic =
    deps.runAtomic ?? (async <T>(fn: (atomicDeps: PaymentServiceDeps) => Promise<T>) => fn(deps));

  return {
    async detectPayment(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existingGenesis = await deps.eventsRepository.findByIdempotencyKey(
        scoped,
        input.idempotencyKey,
      );
      if (existingGenesis) {
        const projection = await deps.projectionRepository.getByPaymentId(
          scoped,
          existingGenesis.paymentId,
        );
        if (projection) {
          return projection;
        }
      }

      const paymentId = crypto.randomUUID();
      const direction = input.direction ?? "INBOUND";

      return runAtomic(async (atomicDeps) =>
        appendEventAndProjection(atomicDeps, scoped, paymentAuditActions.paymentDetected, {
          organizationId: scoped.organizationId,
          paymentId,
          seq: 1,
          eventType: "DETECTED",
          direction,
          subjectModule: input.subjectModule,
          subjectInvoiceId: input.subjectInvoiceId ?? null,
          idempotencyKey: input.idempotencyKey,
          reason: null,
          paymentAddressId: input.paymentAddressId ?? null,
          settlement: null,
          prevEventDigest: null,
        }).then(({ projection }) => projection),
      );
    },

    async confirmPayment(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const current = await deps.projectionRepository.getByPaymentId(scoped, input.paymentId);
      if (!current) {
        throw new PaymentNotFoundError(input.paymentId);
      }

      assertPaymentTransitionAllowed(input.paymentId, current.status, "CONFIRMED");

      const subjectInvoiceId = input.subjectInvoiceId ?? current.subjectInvoiceId;
      const genesisEvents = await deps.eventsRepository.listEventsForPayment(
        scoped,
        input.paymentId,
      );
      const genesisEvent = genesisEvents.find((event) => event.seq === 1) ?? null;
      const paymentAddressId = input.paymentAddressId ?? genesisEvent?.paymentAddressId ?? null;
      if (!hasAttribution(subjectInvoiceId, paymentAddressId)) {
        throw new PaymentAttributionRequiredError(input.paymentId);
      }

      let confirmAuditMetadata: Record<string, unknown> | undefined;
      if (paymentAddressId) {
        if (!deps.addressAttributionReader) {
          throw new Error("[waia-core] payment address attribution reader not configured");
        }

        const address = await deps.addressAttributionReader.getAddressForAttribution(
          scoped,
          paymentAddressId,
        );
        if (!address) {
          throw new AddressNotFoundError(paymentAddressId);
        }
        if (address.organizationId !== scoped.organizationId) {
          throw new AddressOrgOwnershipMismatchError(
            paymentAddressId,
            scoped.organizationId,
            address.organizationId,
          );
        }
        if (!isAddressActiveForAttribution(address.status)) {
          throw new PaymentAddressNotAttributableError(
            input.paymentId,
            paymentAddressId,
            address.status,
          );
        }

        confirmAuditMetadata = {
          paymentAddressId,
          addressStatus: address.status,
          addressValidated: true,
        };
      }

      const existingAttribution = await deps.eventsRepository.findBySettlementAttribution(
        input.settlement.settlementNetwork,
        input.settlement.settlementTxHash,
        input.settlement.transferIndex,
      );
      if (existingAttribution && existingAttribution.paymentId !== input.paymentId) {
        throw new PaymentSettlementAlreadyAttributedError(
          input.settlement.settlementNetwork,
          input.settlement.settlementTxHash,
          input.settlement.transferIndex,
        );
      }

      return runAtomic(async (atomicDeps) =>
        appendEventAndProjection(
          atomicDeps,
          scoped,
          paymentAuditActions.paymentConfirmed,
          {
            organizationId: scoped.organizationId,
            paymentId: input.paymentId,
            seq: current.lastEventSeq + 1,
            eventType: "CONFIRMED",
            direction: current.direction,
            subjectModule: current.subjectModule,
            subjectInvoiceId,
            idempotencyKey: null,
            reason: null,
            paymentAddressId,
            settlement: input.settlement,
            prevEventDigest: current.lastEventDigest,
          },
          confirmAuditMetadata,
        ).then(({ projection }) => projection),
      );
    },

    async failPayment(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const current = await deps.projectionRepository.getByPaymentId(scoped, input.paymentId);
      if (!current) {
        throw new PaymentNotFoundError(input.paymentId);
      }

      assertPaymentTransitionAllowed(input.paymentId, current.status, "FAILED");

      return runAtomic(async (atomicDeps) =>
        appendEventAndProjection(atomicDeps, scoped, paymentAuditActions.paymentFailed, {
          organizationId: scoped.organizationId,
          paymentId: input.paymentId,
          seq: current.lastEventSeq + 1,
          eventType: "FAILED",
          direction: current.direction,
          subjectModule: current.subjectModule,
          subjectInvoiceId: current.subjectInvoiceId,
          idempotencyKey: null,
          reason: input.reason,
          paymentAddressId: null,
          settlement: null,
          prevEventDigest: current.lastEventDigest,
        }).then(({ projection }) => projection),
      );
    },

    async getPayment(context, paymentId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.projectionRepository.getByPaymentId(scoped, paymentId);
    },

    async listPayments(context, query) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.projectionRepository.listPayments(scoped, query);
    },

    async rebuildProjection(context, paymentId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const events = await deps.eventsRepository.listEventsForPayment(scoped, paymentId);
      if (events.length === 0) {
        throw new PaymentNotFoundError(paymentId);
      }

      const projection = foldPaymentEventsToProjection(events);
      if (!projection) {
        throw new Error("[waia-core] payment projection rebuild failed");
      }

      return deps.projectionRepository.upsertProjection(scoped, projection);
    },
  };
}

type PgPaymentExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

function buildSqlitePaymentServiceDeps(
  db: WaiaDb,
  overrides: Partial<PaymentServiceDeps> = {},
): PaymentServiceDeps {
  return {
    eventsRepository: overrides.eventsRepository ?? createSqlitePaymentEventsRepository(db),
    projectionRepository:
      overrides.projectionRepository ?? createSqlitePaymentsProjectionRepository(db),
    addressAttributionReader:
      overrides.addressAttributionReader ?? createSqlitePaymentAddressAttributionReader(db),
    writeAudit: overrides.writeAudit ?? ((input) => writeAuditLogSqlite(db, input)),
    assertMembership:
      overrides.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  };
}

export function createSqlitePaymentService(
  db: WaiaDb,
  overrides: Partial<PaymentServiceDeps> = {},
): PaymentService {
  return createPaymentService({
    ...buildSqlitePaymentServiceDeps(db, overrides),
    runAtomic: async (fn) => fn(buildSqlitePaymentServiceDeps(db, overrides)),
  });
}

export function createPostgresPaymentService(
  ex: PgPaymentExecutor,
  overrides: Partial<PaymentServiceDeps> = {},
  db?: WaiaPostgresDb,
): PaymentService {
  const buildPostgresDeps = (executor: PgPaymentExecutor): PaymentServiceDeps => ({
    eventsRepository: overrides.eventsRepository ?? createPostgresPaymentEventsRepository(executor),
    projectionRepository:
      overrides.projectionRepository ?? createPostgresPaymentsProjectionRepository(executor),
    addressAttributionReader:
      overrides.addressAttributionReader ?? createPostgresPaymentAddressAttributionReader(executor),
    writeAudit: overrides.writeAudit ?? ((input) => writeAuditLogPostgres(executor, input)),
    assertMembership:
      overrides.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(executor, context);
      }),
  });

  return createPaymentService({
    ...buildPostgresDeps(ex),
    runAtomic: async (fn) => {
      if (!db) {
        return fn(buildPostgresDeps(ex));
      }
      return runWaiaPostgresTransaction(db, (tx) => fn(buildPostgresDeps(tx)));
    },
  });
}
