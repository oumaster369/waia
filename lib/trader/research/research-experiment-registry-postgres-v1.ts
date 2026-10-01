import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { researchExperimentIdentityV1, type ResearchExperimentSpecV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { AppendOnlyStrategyAdmissionJournal } from "@/lib/trader/research/strategy-admission-v1";
import { admissionJournalBaseline, commitStrategyAdmissionJournal } from "@/lib/trader/research/strategy-admission-journal-postgres";

export type RegisteredResearchExperimentV1 = Readonly<{
  authority: "REGISTRATION_ONLY";
  specSha256: string;
  spec: ResearchExperimentSpecV1;
  declaredFamilySize: number;
  registeredAt: string;
}>;

type ReadExecutor = Pick<WaiaPostgresDb, "select">;

function canonicalScope(context: OrgContext): OrgContext {
  const scoped = requireOrgContext(context.organizationId);
  return { organizationId: scoped.organizationId.toLowerCase() };
}

async function readRegistered(
  ex: ReadExecutor,
  context: OrgContext,
  specSha256: string,
): Promise<RegisteredResearchExperimentV1> {
  const table = pgSchema.traderResearchExperimentsV1;
  const rows = await ex.select({
    specSha256: table.specSha256,
    familySize: table.familySize,
    specCanonicalJson: table.specCanonicalJson,
    registeredAt: table.registeredAt,
    admissionFamilySize: pgSchema.traderStrategyAdmissionFamily.familySize,
  }).from(table).innerJoin(pgSchema.traderStrategyAdmissionFamily,
    eq(table.specSha256, pgSchema.traderStrategyAdmissionFamily.specSha256))
    .where(and(orgScopedWhere(table.organizationId, context), eq(table.specSha256, specSha256))).limit(1);
  const row = rows[0];
  if (!row) throw new Error("RESEARCH_EXPERIMENT_NOT_REGISTERED");
  const identity = researchExperimentIdentityV1(JSON.parse(row.specCanonicalJson));
  if (identity.specSha256 !== row.specSha256 ||
      canonicalJsonString(identity.spec) !== row.specCanonicalJson ||
      identity.spec.organizationId !== context.organizationId ||
      identity.declaredFamilySize !== row.familySize ||
      identity.declaredFamilySize !== row.admissionFamilySize) {
    throw new Error("RESEARCH_EXPERIMENT_REGISTRATION_MISMATCH");
  }
  return Object.freeze({
    authority: "REGISTRATION_ONLY",
    specSha256: identity.specSha256,
    spec: identity.spec,
    declaredFamilySize: identity.declaredFamilySize,
    registeredAt: row.registeredAt.toISOString(),
  });
}

/** Root read only. A caller's object/hash is never a committed registration.
 * This revalidates stored canonical bytes and the existing admission family.
 * Runner-owned data/executable/receipt validation is a separate required gate. */
export async function loadRegisteredResearchExperimentPostgresV1(
  db: WaiaPostgresDb,
  context: OrgContext,
  specSha256: string,
): Promise<RegisteredResearchExperimentV1> {
  assertResearchRootPostgresDbV1(db);
  const scoped = canonicalScope(context);
  if (!/^[a-f0-9]{64}$/.test(specSha256)) throw new Error("RESEARCH_EXPERIMENT_DIGEST_REQUIRED");
  return readRegistered(db, scoped, specSha256);
}

/** Commits the complete immutable proposal and its exact declared family in
 * one root transaction, before returning. No scorer, callback, holdout read,
 * selected candidate, or fabricated outcome can be supplied to this operation.
 * Registration alone does not prove the requested data/code identities exist. */
export async function registerResearchExperimentPostgresV1(
  db: WaiaPostgresDb,
  context: OrgContext,
  proposal: unknown,
): Promise<RegisteredResearchExperimentV1> {
  assertResearchRootPostgresDbV1(db);
  const scoped = canonicalScope(context);
  const identity = researchExperimentIdentityV1(proposal);
  if (identity.spec.organizationId !== scoped.organizationId) {
    throw new Error("RESEARCH_EXPERIMENT_ORGANIZATION_MISMATCH");
  }
  const canonical = canonicalJsonString(identity.spec);
  await db.transaction(async tx => {
    // Only this proposed family is appended. This does not load or overwrite
    // other experiments' global journal rows or one-shot split consumes.
    const journal = new AppendOnlyStrategyAdmissionJournal();
    const baseline = admissionJournalBaseline(journal);
    journal.registerFamily(identity.specSha256, identity.declaredFamilySize);
    await commitStrategyAdmissionJournal(tx, journal, baseline);
    await tx.insert(pgSchema.traderResearchExperimentsV1).values({
      specSha256: identity.specSha256,
      organizationId: scoped.organizationId,
      familySize: identity.declaredFamilySize,
      specCanonicalJson: canonical,
    }).onConflictDoNothing();
    const persisted = await readRegistered(tx, scoped, identity.specSha256);
    if (canonicalJsonString(persisted.spec) !== canonical) {
      throw new Error("RESEARCH_EXPERIMENT_REGISTRATION_CONFLICT");
    }
  });
  // Read from the root after commit. Nested/savepoint adapters are refused at
  // entry, and an ambiguous commit acknowledgement never starts a score here.
  return loadRegisteredResearchExperimentPostgresV1(db, scoped, identity.specSha256);
}
