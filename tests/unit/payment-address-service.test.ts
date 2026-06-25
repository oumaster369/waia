import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, paymentAddressEvents } from "@/db/schema";
import {
  AddressAlreadyAssignedError,
  AddressAlreadyExistsError,
  AddressDigestMismatchError,
  AddressIdempotencyConflictError,
  AddressNotFoundError,
  buildPaymentAddressEventRecordPayload,
  createSqlitePaymentAddressEventsRepository,
  createSqlitePaymentAddressService,
  IllegalAddressTransitionError,
  paymentAddressAuditActions,
  paymentAddressEntityTypes,
} from "@/lib/waia-core/payment-addresses";
import { deletePaymentAddressProjectionByIdSqlite } from "@/lib/waia-core/payment-addresses/payment-address-repository-adapters";
import { paymentAddressEventPayloadToInsertValues } from "@/lib/waia-core/payment-addresses/payment-address-events-row-mapper";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A_ID = "00000000-0000-4000-8000-0000000316a";
const USER_B_ID = "00000000-0000-4000-8000-0000000316b";
const SUBJECT_REF = "invoice-316-service";

async function createWallet(
  service: ReturnType<typeof createSqlitePaymentAddressService>,
  orgId: string,
) {
  return service.createWallet(requireOrgContext(orgId), {
    walletKind: "DEPOSIT",
    custodyModel: "ORGANIZATION",
    controlModel: "2-of-3",
    status: "active",
  });
}

describe("payment address service (DEE-316 S2-C)", () => {
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-payment-address-service-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "payment-address-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A_ID,
      email: "payment-address-a@waia.invalid",
      password: "password123",
      identityLabel: "Payment Address User A",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_A_ID,
      displayName: "Payment Address User A",
    });

    insertEmailPasswordUser(db, {
      id: USER_B_ID,
      email: "payment-address-b@waia.invalid",
      password: "password123",
      identityLabel: "Payment Address User B",
    });
    otherOrganizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_B_ID,
      displayName: "Payment Address User B",
    });
  });

  it("creates a wallet and emits walletCreated audit", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);

    const wallet = await service.createWallet(context, {
      walletKind: "DEPOSIT",
      custodyModel: "ORGANIZATION",
      controlModel: "2-of-3",
      status: "active",
    });

    expect(wallet.organizationId).toBe(organizationId);

    const audits = db.select().from(auditLogs).where(eq(auditLogs.entityId, wallet.id)).all();
    expect(audits.some((row) => row.action === paymentAddressAuditActions.walletCreated)).toBe(
      true,
    );
    expect(audits.every((row) => row.entityType === paymentAddressEntityTypes.paymentWallet)).toBe(
      true,
    );
  });

  it("generates an address and emits addressGenerated audit", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TGenerate316A",
    });

    expect(generated.status).toBe("GENERATED");

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, generated.addressId))
      .all();
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressGenerated)).toBe(
      true,
    );
  });

  it("runs the full forward lifecycle with audit rows per step", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TLifecycle316Full",
    });
    expect(generated.status).toBe("GENERATED");

    const reserved = await service.reserveAddress(context, { addressId: generated.addressId });
    expect(reserved.status).toBe("RESERVED");

    const assigned = await service.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: SUBJECT_REF,
    });
    expect(assigned.status).toBe("ASSIGNED");

    const activated = await service.activateAddress(context, { addressId: generated.addressId });
    expect(activated.status).toBe("ACTIVATED");

    const rotated = await service.rotateAddress(context, { addressId: generated.addressId });
    expect(rotated.status).toBe("ROTATED");

    const retired = await service.retireAddress(context, { addressId: generated.addressId });
    expect(retired.status).toBe("RETIRED");

    const archived = await service.archiveAddress(context, { addressId: generated.addressId });
    expect(archived.status).toBe("ARCHIVED");

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, generated.addressId))
      .all();
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressGenerated)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressReserved)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressAssigned)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressActivated)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressRotated)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressRetired)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === paymentAddressAuditActions.addressArchived)).toBe(
      true,
    );
  });

  it("supports reserve -> release path", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TRelease316",
    });
    await service.reserveAddress(context, { addressId: generated.addressId });
    const released = await service.releaseAddress(context, { addressId: generated.addressId });
    expect(released.status).toBe("RELEASED");
  });

  it("supports ACTIVATED -> RECOVERED -> ACTIVATED round-trip", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TRecover316",
    });
    await service.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: "recover-316",
    });
    await service.activateAddress(context, { addressId: generated.addressId });

    const recovered = await service.recoverAddress(context, { addressId: generated.addressId });
    expect(recovered.status).toBe("RECOVERED");

    const reactivated = await service.activateAddress(context, { addressId: generated.addressId });
    expect(reactivated.status).toBe("ACTIVATED");
  });

  it("rejects illegal GENERATED -> ACTIVATED transition", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TIllegal316",
    });

    await expect(
      service.activateAddress(context, { addressId: generated.addressId }),
    ).rejects.toThrow(IllegalAddressTransitionError);
  });

  it("rejects transitions from terminal RELEASED", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TTerminal316",
    });
    await service.reserveAddress(context, { addressId: generated.addressId });
    await service.releaseAddress(context, { addressId: generated.addressId });

    await expect(
      service.assignAddress(context, {
        addressId: generated.addressId,
        subjectModule: "trader",
        subjectRef: SUBJECT_REF,
      }),
    ).rejects.toThrow(IllegalAddressTransitionError);
  });

  it("rejects re-assign on already-assigned address", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TReassign316",
    });
    await service.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: SUBJECT_REF,
    });

    await expect(
      service.assignAddress(context, {
        addressId: generated.addressId,
        subjectModule: "trader",
        subjectRef: "other-subject",
      }),
    ).rejects.toThrow(AddressAlreadyAssignedError);
  });

  it("rejects activating a second address for the same active subject", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const addressA = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TActiveSubjectA316",
    });
    await service.assignAddress(context, {
      addressId: addressA.addressId,
      subjectModule: "trader",
      subjectRef: "active-subject-316",
    });
    await service.activateAddress(context, { addressId: addressA.addressId });

    const addressB = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TActiveSubjectB316",
    });
    await service.assignAddress(context, {
      addressId: addressB.addressId,
      subjectModule: "trader",
      subjectRef: "active-subject-316",
    });

    await expect(
      service.activateAddress(context, { addressId: addressB.addressId }),
    ).rejects.toThrow(AddressAlreadyAssignedError);
  });

  it("throws AddressDigestMismatchError when rebuilding with corrupted digest", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);
    const addressId = crypto.randomUUID();

    const payload = buildPaymentAddressEventRecordPayload({
      organizationId,
      addressId,
      walletId: wallet.id,
      seq: 1,
      eventType: "GENERATED",
      network: "TRC-20",
      address: "TDigest316",
      subjectModule: null,
      subjectRef: null,
      bindingRef: null,
      reason: null,
      prevEventDigest: null,
    });

    const tamperedPayload = { ...payload, recordContentDigest: "0".repeat(64) };
    db.insert(paymentAddressEvents)
      .values(
        paymentAddressEventPayloadToInsertValues(
          crypto.randomUUID(),
          organizationId,
          tamperedPayload,
          new Date("2026-06-25T10:00:00.000Z"),
        ),
      )
      .run();

    await expect(service.rebuildAddressProjection(context, addressId)).rejects.toThrow(
      AddressDigestMismatchError,
    );
  });

  it("rebuilds projection after projection row deletion", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TRebuild316",
    });
    await service.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: SUBJECT_REF,
    });
    const activated = await service.activateAddress(context, { addressId: generated.addressId });

    deletePaymentAddressProjectionByIdSqlite(db, context, activated.addressId);
    expect(await service.getAddress(context, activated.addressId)).toBeNull();

    const rebuilt = await service.rebuildAddressProjection(context, activated.addressId);
    expect(rebuilt).toMatchObject({
      addressId: activated.addressId,
      status: "ACTIVATED",
      lastEventSeq: activated.lastEventSeq,
      lastEventDigest: activated.lastEventDigest,
    });
  });

  it("throws AddressNotFoundError when rebuilding unknown address", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.rebuildAddressProjection(context, "00000000-0000-4000-8000-0000000999"),
    ).rejects.toThrow(AddressNotFoundError);
  });

  it("returns the same address on idempotent generateAddress", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const first = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TIdempotent316",
    });
    const second = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TIdempotent316",
    });

    expect(second.addressId).toBe(first.addressId);
  });

  it("throws AddressAlreadyExistsError for cross-org duplicate network/address", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const contextA = requireOrgContext(organizationId);
    const contextB = requireOrgContext(otherOrganizationId);
    const walletA = await createWallet(service, organizationId);
    const walletB = await createWallet(service, otherOrganizationId);

    await service.generateAddress(contextA, {
      walletId: walletA.id,
      network: "TRC-20",
      address: "TCrossOrg316",
    });

    await expect(
      service.generateAddress(contextB, {
        walletId: walletB.id,
        network: "TRC-20",
        address: "TCrossOrg316",
      }),
    ).rejects.toThrow(AddressAlreadyExistsError);
  });

  it("throws AddressIdempotencyConflictError on duplicate seq append", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TDupSeq316",
    });

    const eventsRepo = createSqlitePaymentAddressEventsRepository(db);
    const payload = buildPaymentAddressEventRecordPayload({
      organizationId,
      addressId: generated.addressId,
      walletId: wallet.id,
      seq: 1,
      eventType: "GENERATED",
      network: "TRC-20",
      address: "TDupSeq316",
      subjectModule: null,
      subjectRef: null,
      bindingRef: null,
      reason: null,
      prevEventDigest: null,
    });

    await expect(eventsRepo.insertEvent(context, { payload })).rejects.toThrow(
      AddressIdempotencyConflictError,
    );
  });

  it("returns null for getAddress across orgs", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const contextA = requireOrgContext(organizationId);
    const contextB = requireOrgContext(otherOrganizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(contextA, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TIsolation316",
    });

    expect(await service.getAddress(contextB, generated.addressId)).toBeNull();
  });

  it("throws AddressNotFoundError when transitioning across orgs", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const contextA = requireOrgContext(organizationId);
    const contextB = requireOrgContext(otherOrganizationId);
    const wallet = await createWallet(service, organizationId);

    const generated = await service.generateAddress(contextA, {
      walletId: wallet.id,
      network: "TRC-20",
      address: "TTransitionIsolation316",
    });

    await expect(
      service.assignAddress(contextB, {
        addressId: generated.addressId,
        subjectModule: "trader",
        subjectRef: SUBJECT_REF,
      }),
    ).rejects.toThrow(AddressNotFoundError);
  });

  it("throws when generating with a foreign-org wallet", async () => {
    const db = getDb();
    const service = createSqlitePaymentAddressService(db);
    const contextA = requireOrgContext(organizationId);
    const walletB = await createWallet(service, otherOrganizationId);

    await expect(
      service.generateAddress(contextA, {
        walletId: walletB.id,
        network: "TRC-20",
        address: "TWalletIsolation316",
      }),
    ).rejects.toThrow("[waia-core] payment wallet not found for organization");
  });

  // Dual-DB parity: Postgres path shares fold, row mappers, and service core.
  // Live Postgres parity is exercised by `pnpm db:smoke:postgres` / postgres-integration workflow.
});
