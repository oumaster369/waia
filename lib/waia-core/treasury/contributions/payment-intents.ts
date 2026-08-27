import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { randomUUID } from "node:crypto";

import { and, count, eq, gt } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { resolvePublicTreasuryOrganization } from "@/lib/waia-core/treasury/public/binding";

export const CONTRIBUTION_INTENT_ASSET = "USDT" as const;
export const CONTRIBUTION_INTENT_NETWORK = "TRON" as const;
export const CONTRIBUTION_INTENT_DECIMALS = 6;
export const CONTRIBUTION_INTENT_TTL_MS = 30 * 60 * 1000;
const MIN_AMOUNT_ATOMIC = 1_000_000n;
const MAX_AMOUNT_ATOMIC = 1_000_000_000_000n;
const EXACT_SUFFIX_SPACE = 1000;

export class ContributionIntentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContributionIntentError";
  }
}

export function parseUsdtAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,7}(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new ContributionIntentError(
      "INVALID_AMOUNT",
      "Enter a USDT amount with up to six decimal places.",
    );
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const atomic = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (atomic < MIN_AMOUNT_ATOMIC || atomic > MAX_AMOUNT_ATOMIC) {
    throw new ContributionIntentError(
      "INVALID_AMOUNT",
      "Amount must be between 1 and 1,000,000 USDT.",
    );
  }
  return atomic;
}

export function formatUsdtAtomic(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

function optionalPublicUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) {
    throw new ContributionIntentError("INVALID_URL", `${field} must be a valid public URL.`);
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    throw new ContributionIntentError("INVALID_URL", `${field} must be a valid public URL.`);
  }
}

export type ContributionIntentPublic = {
  id: string;
  address: string;
  exactAmountUsdt: string;
  expiresAt: string;
  status: "PENDING";
};

export async function createContributionPaymentIntent(input: {
  db: WaiaPostgresDb;
  userId: string;
  displayName: string;
  amount: unknown;
  publicSiteUrl?: unknown;
  twinProfileUrl?: unknown;
  consentPublicIdentity: unknown;
  receivingAddress: string;
  now?: Date;
}): Promise<ContributionIntentPublic> {
  const organization = resolvePublicTreasuryOrganization();
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new ContributionIntentError("INVALID_PROFILE", "A valid WAIA profile name is required.");
  }
  if (input.consentPublicIdentity !== true) {
    throw new ContributionIntentError(
      "PUBLIC_CONSENT_REQUIRED",
      "Confirm that your name may be shown in the public Patrons record.",
    );
  }

  const requestedAmountAtomic = parseUsdtAmount(input.amount);
  // Reserve the final three atomic digits for deterministic exact-amount matching.
  const baseAmountAtomic = (requestedAmountAtomic / 1000n) * 1000n;
  const publicSiteUrl = optionalPublicUrl(input.publicSiteUrl, "Website or social profile");
  const twinProfileUrl = optionalPublicUrl(input.twinProfileUrl, "AI-Twin profile");
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CONTRIBUTION_INTENT_TTL_MS);
  const activeRows = await input.db
    .select({ value: count() })
    .from(pgSchema.treasuryContributionPaymentIntents)
    .where(
      and(
        eq(pgSchema.treasuryContributionPaymentIntents.organizationId, organization.organizationId),
        eq(pgSchema.treasuryContributionPaymentIntents.contributorUserId, input.userId),
        eq(pgSchema.treasuryContributionPaymentIntents.status, "PENDING"),
        gt(pgSchema.treasuryContributionPaymentIntents.expiresAt, now),
      ),
    );
  if ((activeRows[0]?.value ?? 0) >= 5) {
    throw new ContributionIntentError(
      "TOO_MANY_ACTIVE_INTENTS",
      "Finish or let an existing payment instruction expire before creating another.",
    );
  }

  for (let suffix = 1; suffix < EXACT_SUFFIX_SPACE; suffix += 1) {
    const id = randomUUID();
    const payableAmountAtomic = baseAmountAtomic + BigInt(suffix);
    if (payableAmountAtomic < requestedAmountAtomic) continue;
    const rows = await input.db
      .insert(pgSchema.treasuryContributionPaymentIntents)
      .values({
        id,
        organizationId: organization.organizationId,
        contributorUserId: input.userId,
        displayNameSnapshot: displayName,
        publicSiteUrl,
        twinProfileUrl,
        consentPublicIdentity: true,
        requestedAmountAtomic,
        payableAmountAtomic,
        assetCode: CONTRIBUTION_INTENT_ASSET,
        network: CONTRIBUTION_INTENT_NETWORK,
        receivingAddress: input.receivingAddress,
        status: "PENDING",
        matchedTransactionId: null,
        expiresAt,
        matchedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: pgSchema.treasuryContributionPaymentIntents.id });
    if (rows[0]) {
      return {
        id,
        address: input.receivingAddress,
        exactAmountUsdt: formatUsdtAtomic(payableAmountAtomic),
        expiresAt: expiresAt.toISOString(),
        status: "PENDING",
      };
    }
  }

  throw new ContributionIntentError(
    "AMOUNT_SLOT_UNAVAILABLE",
    "No exact payment amount is available right now. Try a different amount.",
  );
}

export async function matchContributionPaymentIntent(input: {
  db: Pick<WaiaPostgresDb, "select" | "update" | "insert">;
  organizationId: string;
  transactionId: string;
  toAddress: string;
  amountAtomic: bigint;
  network: string;
  assetCode: string;
  now: Date;
  newId: () => string;
}): Promise<string | null> {
  const rows = await input.db
    .select()
    .from(pgSchema.treasuryContributionPaymentIntents)
    .where(
      and(
        eq(pgSchema.treasuryContributionPaymentIntents.organizationId, input.organizationId),
        eq(pgSchema.treasuryContributionPaymentIntents.status, "PENDING"),
        eq(pgSchema.treasuryContributionPaymentIntents.receivingAddress, input.toAddress),
        eq(pgSchema.treasuryContributionPaymentIntents.payableAmountAtomic, input.amountAtomic),
        eq(pgSchema.treasuryContributionPaymentIntents.network, input.network),
        eq(pgSchema.treasuryContributionPaymentIntents.assetCode, input.assetCode),
      ),
    )
    .limit(1);
  const intent = rows[0];
  if (!intent || intent.expiresAt.getTime() < input.now.getTime()) return null;

  const updated = await input.db
    .update(pgSchema.treasuryContributionPaymentIntents)
    .set({
      status: "MATCHED",
      matchedTransactionId: input.transactionId,
      matchedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(pgSchema.treasuryContributionPaymentIntents.id, intent.id),
        eq(pgSchema.treasuryContributionPaymentIntents.status, "PENDING"),
      ),
    )
    .returning({ id: pgSchema.treasuryContributionPaymentIntents.id });
  if (!updated[0]) return null;

  await input.db.insert(pgSchema.treasuryContributionAttributions).values({
    id: input.newId(),
    organizationId: input.organizationId,
    transactionId: input.transactionId,
    status: "ATTRIBUTED",
    contributorUserId: intent.contributorUserId,
    attributionMethod: "EXACT_PAYMENT_INTENT",
    consentPublicIdentity: intent.consentPublicIdentity,
    publicSiteUrl: intent.publicSiteUrl,
    twinProfileUrl: intent.twinProfileUrl,
    note: "Matched to an authenticated, exact-amount public support intent.",
    attributedByUserId: null,
    attributedAt: input.now,
    revokedAt: null,
    createdAt: input.now,
  });
  return intent.id;
}
