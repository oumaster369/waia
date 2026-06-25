import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import {
  AddressNotFoundError,
  createSqlitePaymentAddressService,
} from "@/lib/waia-core/payment-addresses";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses";
import {
  createPaymentService,
  createSqlitePaymentEventsRepository,
  createSqlitePaymentService,
  createSqlitePaymentsProjectionRepository,
  PaymentAddressNotAttributableError,
  PaymentSettlementAlreadyAttributedError,
  paymentAuditActions,
} from "@/lib/waia-core/payments";
import { deletePaymentProjectionByIdSqlite } from "@/lib/waia-core/payments/payment-repository-adapters";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A_ID = "00000000-0000-4000-8000-0000000317a";
const USER_B_ID = "00000000-0000-4000-8000-0000000317b";
const INVOICE_ID = "invoice-317-confirm";
const SUBJECT_REF_PREFIX = "subject-317-confirm";

function subjectRefFor(suffix: string) {
  return `${SUBJECT_REF_PREFIX}-${suffix}`;
}

const SETTLEMENT = {
  settlementNetwork: "TRC20",
  settlementAsset: "USDT",
  settlementAmount: "150.00",
  settlementTxHash: "317abc-confirm-tx",
  transferIndex: 0,
  confirmationsRequired: 20,
  confirmationsObserved: 20,
  blockHeight: "12345",
  observedAt: new Date("2026-06-25T10:00:00.000Z"),
  confirmedAt: new Date("2026-06-25T10:05:00.000Z"),
  valuedAmountUsd: "150.00",
  valuationSource: "usdt_usd_peg.v1",
  valuationAt: new Date("2026-06-25T10:05:01.000Z"),
  evidenceRef: "watcher://317-confirm",
};

function settlementWithTxHash(txHash: string) {
  return { ...SETTLEMENT, settlementTxHash: txHash };
}

async function createWallet(
  addressService: ReturnType<typeof createSqlitePaymentAddressService>,
  orgId: string,
) {
  return addressService.createWallet(requireOrgContext(orgId), {
    walletKind: "DEPOSIT",
    custodyModel: "ORGANIZATION",
    controlModel: "2-of-3",
    status: "active",
  });
}

async function generateAddress(
  addressService: ReturnType<typeof createSqlitePaymentAddressService>,
  orgId: string,
  walletId: string,
  suffix: string,
) {
  return addressService.generateAddress(requireOrgContext(orgId), {
    walletId,
    network: "TRC-20",
    address: `TConfirm317${suffix}`,
  });
}

async function driveToStatus(
  addressService: ReturnType<typeof createSqlitePaymentAddressService>,
  orgId: string,
  addressId: string,
  targetStatus: PaymentAddressProjectionView["status"],
  subjectRef: string,
) {
  const context = requireOrgContext(orgId);
  const assign = (id: string) =>
    addressService.assignAddress(context, {
      addressId: id,
      subjectModule: "trader",
      subjectRef,
    });

  const sequences: Record<
    PaymentAddressProjectionView["status"],
    Array<(id: string) => Promise<PaymentAddressProjectionView>>
  > = {
    GENERATED: [],
    RESERVED: [(id) => addressService.reserveAddress(context, { addressId: id })],
    RELEASED: [
      (id) => addressService.reserveAddress(context, { addressId: id }),
      (id) => addressService.releaseAddress(context, { addressId: id }),
    ],
    ASSIGNED: [assign],
    ACTIVATED: [assign, (id) => addressService.activateAddress(context, { addressId: id })],
    ROTATED: [
      assign,
      (id) => addressService.activateAddress(context, { addressId: id }),
      (id) => addressService.rotateAddress(context, { addressId: id }),
    ],
    RETIRED: [
      assign,
      (id) => addressService.activateAddress(context, { addressId: id }),
      (id) => addressService.rotateAddress(context, { addressId: id }),
      (id) => addressService.retireAddress(context, { addressId: id }),
    ],
    ARCHIVED: [
      assign,
      (id) => addressService.activateAddress(context, { addressId: id }),
      (id) => addressService.rotateAddress(context, { addressId: id }),
      (id) => addressService.retireAddress(context, { addressId: id }),
      (id) => addressService.archiveAddress(context, { addressId: id }),
    ],
    RECOVERED: [
      assign,
      (id) => addressService.activateAddress(context, { addressId: id }),
      (id) => addressService.recoverAddress(context, { addressId: id }),
    ],
  };

  let current = await addressService.getAddress(context, addressId);
  if (!current) {
    throw new Error(`address not found: ${addressId}`);
  }

  for (const step of sequences[targetStatus]) {
    if (current.status === targetStatus) {
      return current;
    }
    current = await step(addressId);
  }

  if (current.status !== targetStatus) {
    throw new Error(`failed to drive ${addressId} to ${targetStatus}; ended at ${current.status}`);
  }

  return current;
}

async function detectWithAddress(
  paymentService: ReturnType<typeof createSqlitePaymentService>,
  orgId: string,
  idempotencyKey: string,
  paymentAddressId: string,
) {
  return paymentService.detectPayment(requireOrgContext(orgId), {
    idempotencyKey,
    subjectModule: "trader",
    subjectInvoiceId: null,
    paymentAddressId,
  });
}

describe("payment confirm address validation (DEE-317 S2-D)", () => {
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-payment-confirm-address-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "payment-confirm-address.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A_ID,
      email: "payment-confirm-a@waia.invalid",
      password: "password123",
      identityLabel: "Payment Confirm User A",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_A_ID,
      displayName: "Payment Confirm User A",
    });

    insertEmailPasswordUser(db, {
      id: USER_B_ID,
      email: "payment-confirm-b@waia.invalid",
      password: "password123",
      identityLabel: "Payment Confirm User B",
    });
    otherOrganizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_B_ID,
      displayName: "Payment Confirm User B",
    });
  });

  it("rejects confirmation when paymentAddressId belongs to another org", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const walletB = await createWallet(addressService, otherOrganizationId);
    const addressB = await generateAddress(addressService, otherOrganizationId, walletB.id, "OrgB");
    await driveToStatus(
      addressService,
      otherOrganizationId,
      addressB.addressId,
      "ACTIVATED",
      subjectRefFor("OrgB"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-wrong-org",
      addressB.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-wrong-org"),
      }),
    ).rejects.toThrow(AddressNotFoundError);
  });

  it("rejects confirmation when paymentAddressId is missing", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const missingAddressId = "00000000-0000-4000-8000-0000000317xx";

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-missing",
      missingAddressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-missing"),
      }),
    ).rejects.toThrow(AddressNotFoundError);
  });

  it("rejects confirmation when address is GENERATED", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Generated");

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-generated",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-generated"),
      }),
    ).rejects.toThrow(PaymentAddressNotAttributableError);
  });

  it("rejects confirmation when address is ASSIGNED but not activated", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Assigned");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ASSIGNED",
      subjectRefFor("Assigned"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-assigned",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-assigned"),
      }),
    ).rejects.toThrow(PaymentAddressNotAttributableError);
  });

  it("rejects confirmation when address is ARCHIVED", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Archived");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ARCHIVED",
      subjectRefFor("Archived"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-archived",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-archived"),
      }),
    ).rejects.toThrow(PaymentAddressNotAttributableError);
  });

  it("rejects confirmation when address is RECOVERED", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Recovered");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "RECOVERED",
      subjectRefFor("Recovered"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-recovered",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-recovered"),
      }),
    ).rejects.toThrow(PaymentAddressNotAttributableError);
  });

  it("confirms when address is ROTATED", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Rotated");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ROTATED",
      subjectRefFor("Rotated"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-rotated",
      generated.addressId,
    );

    const confirmed = await paymentService.confirmPayment(requireOrgContext(organizationId), {
      paymentId: detected.paymentId,
      settlement: settlementWithTxHash("317-rotated"),
    });

    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("confirms ACTIVATED address and enriches confirm audit metadata", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Activated");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ACTIVATED",
      subjectRefFor("Activated"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-activated",
      generated.addressId,
    );

    const confirmed = await paymentService.confirmPayment(requireOrgContext(organizationId), {
      paymentId: detected.paymentId,
      settlement: settlementWithTxHash("317-activated"),
    });

    expect(confirmed.status).toBe("CONFIRMED");

    const confirmAudit = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, detected.paymentId))
      .all()
      .find((row) => row.action === paymentAuditActions.paymentConfirmed);

    expect(confirmAudit).toBeDefined();
    const metadata = JSON.parse(confirmAudit!.metadataJson) as Record<string, unknown>;
    expect(metadata.paymentAddressId).toBe(generated.addressId);
    expect(metadata.addressStatus).toBe("ACTIVATED");
    expect(metadata.addressValidated).toBe(true);
  });

  it("preserves invoice-only confirmation without consulting the address reader", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const detected = await paymentService.detectPayment(context, {
      idempotencyKey: "detect-317-invoice-only",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
      paymentAddressId: null,
    });

    const confirmed = await paymentService.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: settlementWithTxHash("317-invoice-only"),
    });

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.subjectInvoiceId).toBe(INVOICE_ID);
  });

  it("fails closed when addressAttributionReader is absent and paymentAddressId is set", async () => {
    const db = getDb();
    const paymentService = createPaymentService({
      eventsRepository: createSqlitePaymentEventsRepository(db),
      projectionRepository: createSqlitePaymentsProjectionRepository(db),
      writeAudit: () => "audit-stub",
    });
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(
      addressService,
      organizationId,
      wallet.id,
      "FailClosed",
    );
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ACTIVATED",
      subjectRefFor("FailClosed"),
    );

    const detected = await detectWithAddress(
      createSqlitePaymentService(db),
      organizationId,
      "detect-317-fail-closed",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: detected.paymentId,
        settlement: settlementWithTxHash("317-fail-closed"),
      }),
    ).rejects.toThrow("[waia-core] payment address attribution reader not configured");
  });

  it("allows multiple distinct settlements to the same ACTIVATED address", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "DupAddr");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ACTIVATED",
      subjectRefFor("DupAddr"),
    );

    const first = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-dup-a",
      generated.addressId,
    );
    const second = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-dup-b",
      generated.addressId,
    );

    const firstConfirmed = await paymentService.confirmPayment(requireOrgContext(organizationId), {
      paymentId: first.paymentId,
      settlement: settlementWithTxHash("317-dup-a"),
    });
    const secondConfirmed = await paymentService.confirmPayment(requireOrgContext(organizationId), {
      paymentId: second.paymentId,
      settlement: settlementWithTxHash("317-dup-b"),
    });

    expect(firstConfirmed.status).toBe("CONFIRMED");
    expect(secondConfirmed.status).toBe("CONFIRMED");
  });

  it("blocks double attribution of the same settlement transfer", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "DupSettle");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ACTIVATED",
      subjectRefFor("DupSettle"),
    );

    const first = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-settle-a",
      generated.addressId,
    );
    await paymentService.confirmPayment(requireOrgContext(organizationId), {
      paymentId: first.paymentId,
      settlement: settlementWithTxHash("317-double-settle"),
    });

    const second = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-settle-b",
      generated.addressId,
    );

    await expect(
      paymentService.confirmPayment(requireOrgContext(organizationId), {
        paymentId: second.paymentId,
        settlement: settlementWithTxHash("317-double-settle"),
      }),
    ).rejects.toThrow(PaymentSettlementAlreadyAttributedError);
  });

  it("rebuilds payment projection deterministically after deletion and blocks cross-org reads", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const addressService = createSqlitePaymentAddressService(db);
    const contextA = requireOrgContext(organizationId);
    const contextB = requireOrgContext(otherOrganizationId);

    const wallet = await createWallet(addressService, organizationId);
    const generated = await generateAddress(addressService, organizationId, wallet.id, "Replay");
    await driveToStatus(
      addressService,
      organizationId,
      generated.addressId,
      "ACTIVATED",
      subjectRefFor("Replay"),
    );

    const detected = await detectWithAddress(
      paymentService,
      organizationId,
      "detect-317-replay",
      generated.addressId,
    );
    const confirmed = await paymentService.confirmPayment(contextA, {
      paymentId: detected.paymentId,
      settlement: settlementWithTxHash("317-replay"),
    });

    deletePaymentProjectionByIdSqlite(db, contextA, confirmed.paymentId);
    expect(await paymentService.getPayment(contextA, confirmed.paymentId)).toBeNull();
    expect(await paymentService.getPayment(contextB, confirmed.paymentId)).toBeNull();

    const rebuilt = await paymentService.rebuildProjection(contextA, confirmed.paymentId);
    expect(rebuilt).toMatchObject({
      paymentId: confirmed.paymentId,
      status: "CONFIRMED",
      settlementTxHash: "317-replay",
      lastEventSeq: confirmed.lastEventSeq,
      lastEventDigest: confirmed.lastEventDigest,
    });
  });

  // SQLite/Postgres parity: validation lives in the shared createPaymentService core;
  // both factories wire an org-scoped reader. Live PG parity is exercised by
  // pnpm db:smoke:postgres / the postgres-integration workflow (no migration in this slice).
});
