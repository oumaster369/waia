import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { USDT_TRC20_CONTRACT } from "@/lib/waia-core/payment-watcher/watcher-config";
import * as treasury from "@/lib/waia-core/treasury";
import {
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  createContributionShareEngine,
  getBreathPublicSnapshot,
  getPublicContributionAggregate,
  getSelfContributionShare,
} from "@/lib/waia-core/treasury";
import type { ContributionShareFactsRepository } from "@/lib/waia-core/treasury/share/repository.types";
import { resolveTreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/resolve";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import {
  ORG_B,
  USER_A,
  USER_B,
  createWp7Bundle,
  ctxA,
  ctxB,
  seedOpenAttribution,
  seedPublishableControl,
  seedQualifyingContribution,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp7";

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("DEE-606 WP-7 aggregate/self privacy and isolation", () => {
  it("65-76 public aggregate-only; self-only; no identity/HTTP/UI/equity", async () => {
    const { services, engine } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "tx-secret-id-aaa",
      accountingAmountMicros: 3_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "tx-secret-id-bbb",
      accountingAmountMicros: 1_000_000n,
    });
    await seedOpenAttribution(services, {
      id: "attr-secret-id-aaa",
      transactionId: "tx-secret-id-aaa",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      consentPublicIdentity: true,
      note: "Alice Example alice@example.com",
    });
    await seedOpenAttribution(services, {
      id: "attr-secret-id-bbb",
      transactionId: "tx-secret-id-bbb",
      status: "ATTRIBUTED",
      contributorUserId: USER_B,
      consentPublicIdentity: true,
    });

    const publicAgg = await getPublicContributionAggregate(ctxA, engine);
    expect(publicAgg).toEqual({
      totalNetContributionMicros: "4000000",
      qualifyingContributionCount: 2,
      lastUpdatedAt: publicAgg.lastUpdatedAt,
    });
    expect(Object.keys(publicAgg).sort()).toEqual(
      ["lastUpdatedAt", "qualifyingContributionCount", "totalNetContributionMicros"].sort(),
    );
    const publicJson = JSON.stringify(publicAgg);
    expect(publicJson).not.toContain(USER_A);
    expect(publicJson).not.toContain(USER_B);
    expect(publicJson).not.toContain("alice@example.com");
    expect(publicJson).not.toContain("Alice Example");
    expect(publicJson).not.toContain("tx-secret-id-aaa");
    expect(publicJson).not.toContain("attr-secret-id-aaa");
    expect(publicJson).not.toContain("contributors");
    expect(publicAgg).not.toHaveProperty("contributors");
    expect(publicAgg).not.toHaveProperty("topContributors");
    expect(publicAgg).not.toHaveProperty("leaderboard");
    expect(publicAgg).not.toHaveProperty("publicContributorName");

    const self = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(self.numeratorMicros).toBe("3000000");
    expect(self.denominatorMicros).toBe("4000000");
    const selfJson = JSON.stringify(self);
    expect(selfJson).not.toContain(USER_B);
    expect(selfJson).not.toContain("tx-secret-id-bbb");
    expect(selfJson).not.toContain("Alice");
    expect(self).not.toHaveProperty("contributorUserId");
    expect(self).not.toHaveProperty("otherUserId");

    await expect(getSelfContributionShare(ctxA, "   ", engine)).rejects.toMatchObject({
      reasonCode: "USER_ID_REQUIRED",
    });

    expect(TREASURY_USDT_V1_TOKEN_CONTRACT).toBe(USDT_TRC20_CONTRACT);
    expect("getPublicContributionAggregate" in treasury).toBe(true);
    expect("getSelfContributionShare" in treasury).toBe(true);

    const root = process.cwd();
    expect(existsSync(path.join(root, "app/api/public/contributors"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/treasury/contributors"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/contribution-share"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/breath/contributors"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/public/treasury"))).toBe(true);

    const publicRoute = readFileSync(
      path.join(root, "app/api/public/treasury/route.ts"),
      "utf8",
    );
    expect(publicRoute).not.toContain("contributors");
    expect(publicRoute).not.toContain("user_id");
    expect(publicRoute).not.toContain("userId");

    const shareDir = path.join(root, "lib/waia-core/treasury/share");
    const shareSrc = walkTs(shareDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(shareSrc).not.toContain("equityPercentage");
    expect(shareSrc).not.toContain("ownershipPercentage");
    expect(shareSrc).not.toContain("governanceWeight");
    expect(shareSrc).not.toContain("votingPower");
    expect(shareSrc).not.toContain("profitShare");
    expect(shareSrc).not.toContain("topContributors");
    expect(shareSrc).not.toContain("leaderboard");
    expect(shareSrc).not.toContain("app/api");
  });

  it("77-85 org isolation; no R2/watcher/Breath/runway/payment-watcher/AI-Trader mutation", async () => {
    const { services, engine } = createWp7Bundle();
    await seedPublishableControl(services);
    await seedQualifyingContribution(services, {
      id: "org-a-c",
      accountingAmountMicros: 5_000_000n,
    });
    await seedOpenAttribution(services, {
      id: "org-a-attr",
      transactionId: "org-a-c",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
    });
    await seedQualifyingContribution(services, {
      id: "org-b-c",
      organizationId: ORG_B,
      accountingAmountMicros: 9_000_000n,
    });
    await seedOpenAttribution(services, {
      id: "org-b-attr",
      organizationId: ORG_B,
      transactionId: "org-b-c",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
    });

    const breathBefore = await getBreathPublicSnapshot(ctxA, services.breath);
    const selfA = await getSelfContributionShare(ctxA, USER_A, engine);
    const selfBOrg = await getSelfContributionShare(ctxB, USER_A, engine);
    const publicA = await getPublicContributionAggregate(ctxA, engine);
    const publicB = await getPublicContributionAggregate(ctxB, engine);
    const breathAfter = await getBreathPublicSnapshot(ctxA, services.breath);

    expect(selfA.denominatorMicros).toBe("5000000");
    expect(selfA.numeratorMicros).toBe("5000000");
    expect(publicA.totalNetContributionMicros).toBe("5000000");
    expect(selfBOrg.denominatorMicros).toBe("9000000");
    expect(selfBOrg.numeratorMicros).toBe("9000000");
    expect(publicB.totalNetContributionMicros).toBe("9000000");
    expect(JSON.stringify(breathBefore)).toBe(JSON.stringify(breathAfter));

    await seedTx(services, {
      id: "breath-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      cashEffectMicros: -1_000_000n,
    });
    const shareAfterExpense = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(shareAfterExpense.denominatorMicros).toBe("5000000");

    expect(resolveTreasuryEvidenceStorage()).toBeNull();
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);

    const root = process.cwd();
    const wrangler = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"binding": "TREASURY_EVIDENCE_R2"');
    expect(wrangler).toContain('"bucket_name": "waia-treasury-evidence-prod"');
    expect(wrangler).not.toMatch(/r2\.dev|public_bucket|custom_domain/i);
    expect(wrangler).not.toContain("TREASURY_WATCHER_ENABLED");

    const shareDir = path.join(root, "lib/waia-core/treasury/share");
    const shareSrc = walkTs(shareDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(shareSrc).not.toContain("TREASURY_EVIDENCE_R2");
    expect(shareSrc).not.toContain("r2-adapter");
    expect(shareSrc).not.toContain("@/lib/waia-core/payment-watcher");
    expect(shareSrc).not.toContain("ai-trader");
    expect(shareSrc).not.toContain("AI-Trader");
    expect(shareSrc).not.toContain("Org-0");
    expect(shareSrc).not.toMatch(/\blimit\s*\(/i);
    expect(shareSrc).not.toContain("limit ?? 50");
    expect(readFileSync(path.join(shareDir, "postgres-repository.ts"), "utf8")).toContain(
      "orgScopedWhere",
    );
    expect(readFileSync(path.join(shareDir, "memory-repository.ts"), "utf8")).toContain(
      "listTransactions(org)",
    );
    expect(readFileSync(path.join(shareDir, "memory-repository.ts"), "utf8")).not.toContain(
      "listTransactions(org, {",
    );

    const breathDir = path.join(root, "lib/waia-core/treasury/breath");
    const breathSrc = walkTs(breathDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(breathSrc).not.toContain("createContributionShareEngine");
    expect(breathSrc).not.toContain("getSelfContributionShare");
    expect(breathSrc).not.toContain("getPublicContributionAggregate");

    const paymentWatcher = walkTs(path.join(root, "lib/waia-core/payment-watcher"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(paymentWatcher).not.toContain("lib/waia-core/treasury/share");
    expect(paymentWatcher).not.toContain("getSelfContributionShare");

    expect(publicA.lastUpdatedAt).toBe("2026-08-13T12:00:00.000Z");
  });
});

const ATTR_LATER = new Date("2026-08-13T18:00:00.000Z");
const TX_LATER = new Date("2026-08-13T19:00:00.000Z");

function instrumentFacts(inner: ContributionShareFactsRepository) {
  const calls = { contribution: 0, attribution: 0 };
  const facts: ContributionShareFactsRepository = {
    async loadContributionFacts(context) {
      calls.contribution += 1;
      return inner.loadContributionFacts(context);
    },
    async loadAttributionFacts(context) {
      calls.attribution += 1;
      return inner.loadAttributionFacts(context);
    },
  };
  return { facts, calls };
}

describe("DEE-606 WP-7 public-aggregate privacy / timestamp correction", () => {
  it("attribution-only changes do not alter public totals, count, or lastUpdatedAt", async () => {
    const { services, engine, facts } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "pub-c",
      accountingAmountMicros: 4_000_000n,
    });
    const before = await getPublicContributionAggregate(ctxA, engine);
    expect(before).toEqual({
      totalNetContributionMicros: "4000000",
      qualifyingContributionCount: 1,
      lastUpdatedAt: "2026-08-13T12:00:00.000Z",
    });

    await seedOpenAttribution(services, {
      id: "attr-create",
      transactionId: "pub-c",
      status: "UNMATCHED",
      createdAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(before);

    await services.catalogRepo.updateAdminAttribution(ctxA, "attr-create", {
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      attributedAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(before);

    await services.catalogRepo.updateAdminAttribution(ctxA, "attr-create", {
      status: "ATTRIBUTED",
      contributorUserId: USER_B,
      attributedAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(before);

    await services.catalogRepo.updateAdminAttribution(ctxA, "attr-create", {
      revokedAt: ATTR_LATER,
    });
    await seedOpenAttribution(services, {
      id: "attr-reassign",
      transactionId: "pub-c",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      createdAt: ATTR_LATER,
      attributedAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(before);

    await seedQualifyingContribution(services, {
      id: "pub-anon",
      accountingAmountMicros: 1_000_000n,
    });
    const withSecond = await getPublicContributionAggregate(ctxA, engine);
    await seedOpenAttribution(services, {
      id: "attr-anon",
      transactionId: "pub-anon",
      status: "ANONYMOUS",
      createdAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(withSecond);
    await services.catalogRepo.updateAdminAttribution(ctxA, "attr-anon", {
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      attributedAt: ATTR_LATER,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(withSecond);

    await services.catalogRepo.updateAdminAttribution(ctxA, "attr-reassign", {
      consentPublicIdentity: true,
      note: "public name please",
      attributedByUserId: USER_B,
    });
    expect(await getPublicContributionAggregate(ctxA, engine)).toEqual(withSecond);

    const selfAfter = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(selfAfter.numeratorMicros).toBe("5000000");
    expect(selfAfter.lastUpdatedAt).toBe(ATTR_LATER.toISOString());
    expect(JSON.stringify(selfAfter)).not.toContain(USER_B);
    expect(JSON.stringify(await getPublicContributionAggregate(ctxA, engine))).not.toContain(
      USER_A,
    );

    const instrumented = instrumentFacts(facts);
    const isolated = createContributionShareEngine(instrumented.facts);
    await getPublicContributionAggregate(ctxA, isolated);
    expect(instrumented.calls.contribution).toBe(1);
    expect(instrumented.calls.attribution).toBe(0);
    await getSelfContributionShare(ctxA, USER_A, isolated);
    expect(instrumented.calls.attribution).toBe(1);

    const engineSrc = readFileSync(
      path.join(process.cwd(), "lib/waia-core/treasury/share/engine.ts"),
      "utf8",
    );
    const publicFn = engineSrc.slice(engineSrc.indexOf("async computePublicAggregate"));
    expect(publicFn).not.toContain("loadAttributionFacts");
    expect(publicFn).not.toContain("contributorUserId");
    const postgresSrc = readFileSync(
      path.join(process.cwd(), "lib/waia-core/treasury/share/postgres-repository.ts"),
      "utf8",
    );
    const contribFn = postgresSrc.slice(
      postgresSrc.indexOf("async loadContributionFacts"),
      postgresSrc.indexOf("async loadAttributionFacts"),
    );
    expect(contribFn).not.toContain("treasuryContributionAttributions");
    expect(contribFn).not.toContain("contributorUserId");
    expect(contribFn).not.toContain("consentPublicIdentity");
  });

  it("public lastUpdatedAt changes when Q or used netting facts change; self-share follows attribution", async () => {
    const { services, engine } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "q-early",
      accountingAmountMicros: 1_000_000n,
    });
    const baseline = await getPublicContributionAggregate(ctxA, engine);
    expect(baseline.lastUpdatedAt).toBe("2026-08-13T12:00:00.000Z");

    await services.domain.repository.updateTransaction(ctxA, "q-early", {
      accountingAmountMicros: 2_000_000n,
      cashEffectMicros: 2_000_000n,
      nativeAmountAtomic: 2_000_000n,
      updatedAt: TX_LATER,
    });
    const afterAmount = await getPublicContributionAggregate(ctxA, engine);
    expect(afterAmount.totalNetContributionMicros).toBe("2000000");
    expect(afterAmount.lastUpdatedAt).toBe(TX_LATER.toISOString());

    await seedQualifyingContribution(services, {
      id: "q-enter",
      status: "CLASSIFIED",
      accountingAmountMicros: 3_000_000n,
      updatedAt: ATTR_LATER,
    });
    expect((await getPublicContributionAggregate(ctxA, engine)).qualifyingContributionCount).toBe(
      1,
    );
    await services.domain.repository.updateTransaction(ctxA, "q-enter", {
      status: "VERIFIED",
      verifiedAt: TX_LATER,
      updatedAt: TX_LATER,
    });
    const afterEnter = await getPublicContributionAggregate(ctxA, engine);
    expect(afterEnter.qualifyingContributionCount).toBe(2);
    expect(afterEnter.lastUpdatedAt).toBe(TX_LATER.toISOString());

    await services.domain.repository.updateTransaction(ctxA, "q-enter", {
      status: "RECONCILIATION_REQUIRED",
      updatedAt: new Date("2026-08-13T21:00:00.000Z"),
    });
    const afterExit = await getPublicContributionAggregate(ctxA, engine);
    expect(afterExit.qualifyingContributionCount).toBe(1);
    expect(afterExit.lastUpdatedAt).toBe(TX_LATER.toISOString());
    expect(afterExit.lastUpdatedAt).not.toBe("2026-08-13T21:00:00.000Z");

    await seedTx(services, {
      id: "refund-used",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 100_000n,
      cashEffectMicros: -100_000n,
      correctsTransactionId: "q-early",
      verifiedAt: new Date("2026-08-13T22:00:00.000Z"),
      updatedAt: new Date("2026-08-13T22:00:00.000Z"),
    });
    const afterRefund = await getPublicContributionAggregate(ctxA, engine);
    expect(afterRefund.totalNetContributionMicros).toBe("1900000");
    expect(afterRefund.lastUpdatedAt).toBe("2026-08-13T22:00:00.000Z");

    await seedTx(services, {
      id: "corr-used",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 50_000n,
      cashEffectMicros: 50_000n,
      correctsTransactionId: "q-early",
      verifiedAt: new Date("2026-08-13T23:00:00.000Z"),
      updatedAt: new Date("2026-08-13T23:00:00.000Z"),
    });
    const afterCorr = await getPublicContributionAggregate(ctxA, engine);
    expect(afterCorr.totalNetContributionMicros).toBe("1950000");
    expect(afterCorr.lastUpdatedAt).toBe("2026-08-13T23:00:00.000Z");

    const selfBefore = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(selfBefore.numeratorMicros).toBe("0");
    await seedOpenAttribution(services, {
      id: "self-attr",
      transactionId: "q-early",
      status: "ATTRIBUTED",
      contributorUserId: USER_B,
      createdAt: ATTR_LATER,
      attributedAt: ATTR_LATER,
    });
    expect((await getSelfContributionShare(ctxA, USER_A, engine)).numeratorMicros).toBe("0");
    await services.catalogRepo.updateAdminAttribution(ctxA, "self-attr", {
      revokedAt: ATTR_LATER,
    });
    await seedOpenAttribution(services, {
      id: "self-attr-2",
      transactionId: "q-early",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      createdAt: ATTR_LATER,
      attributedAt: ATTR_LATER,
    });
    const selfMine = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(selfMine.numeratorMicros).toBe("1950000");
    expect(selfMine.lastUpdatedAt).toBe("2026-08-13T23:00:00.000Z");
    await services.catalogRepo.updateAdminAttribution(ctxA, "self-attr-2", {
      attributedAt: new Date("2026-08-14T01:00:00.000Z"),
    });
    const selfTimed = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(selfTimed.numeratorMicros).toBe("1950000");
    expect(selfTimed.lastUpdatedAt).toBe("2026-08-14T01:00:00.000Z");
    expect((await getPublicContributionAggregate(ctxA, engine)).lastUpdatedAt).toBe(
      "2026-08-13T23:00:00.000Z",
    );
  });
});
