import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { ResearchOrchestratorError } from "@/lib/trader/research/errors";
import { isPostgresUniqueViolation } from "@/lib/trader/research/postgres-unique-violation";

const BLIND_DIGEST = /^[0-9a-f]{64}$/;

/**
 * DEE-540 consumption token. Hashes the sealed blind-split bar digest only.
 * datasetName, vaultDir, and the rest of the caller scope are not inputs, so
 * renaming those labels cannot mint a second consume for the same bars.
 */
export function computeDee540BarContentToken(blindDigest: string): string {
  const digest = blindDigest.trim();
  if (!BLIND_DIGEST.test(digest)) {
    throw new ResearchOrchestratorError(
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
      "DEE-540 consumption requires the sealed bar-content digest",
    );
  }
  return createHash("sha256")
    .update(
      canonicalJsonString({
        kind: "dee540_bar_content_v1",
        blindDigest: digest,
      }),
      "utf8",
    )
    .digest("hex");
}

type Dee540Insert = Pick<WaiaPostgresDb, "insert">;

/**
 * Consumes a bar-content token exactly once. The primary key is the concurrency
 * gate. There is no path override and no replay that clears the row.
 */
export async function consumeDee540BlindTailAuthorization(
  ex: Dee540Insert,
  input: { blindDigest: string },
): Promise<string> {
  const token = computeDee540BarContentToken(input.blindDigest);
  try {
    await ex.insert(pgSchema.traderDee540BarConsumption).values({
      barContentToken: token,
      blindDigest: input.blindDigest.trim(),
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      throw new ResearchOrchestratorError(
        "DEE540_AUTHORIZATION_ALREADY_CONSUMED",
        "this blind-tail bar content was already consumed",
      );
    }
    if (error instanceof ResearchOrchestratorError) throw error;
    throw new ResearchOrchestratorError(
      "DEE540_AUTHORIZATION_STORE_UNAVAILABLE",
      error instanceof Error ? error.message : "authorization store unavailable",
    );
  }
  return token;
}

/** Read-only: whether this bar-content token was already consumed. Does not insert. */
export async function dee540BarContentConsumed(
  ex: Pick<WaiaPostgresDb, "select">,
  blindDigest: string,
): Promise<boolean> {
  const token = computeDee540BarContentToken(blindDigest);
  const rows = await ex
    .select({ token: pgSchema.traderDee540BarConsumption.barContentToken })
    .from(pgSchema.traderDee540BarConsumption)
    .where(eq(pgSchema.traderDee540BarConsumption.barContentToken, token))
    .limit(1);
  return rows.length > 0;
}
