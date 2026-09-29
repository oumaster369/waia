import type postgres from "postgres";

export type CurrentAccountAuthorityV1 =
  | { current: false; reason: "NO_CURRENT_POINTER" }
  | { current: false; reason: "BASIS_ABSENT" }
  | { current: false; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT"; basisDigest: string };

/** A stored pointer never becomes trading authority without a live envelope producer. */
export function classifyCurrentAccountRowV1(
  row: { basis_digest: string | null } | null,
): CurrentAccountAuthorityV1 {
  if (!row) return { current: false, reason: "NO_CURRENT_POINTER" };
  if (!row.basis_digest) return { current: false, reason: "BASIS_ABSENT" };
  return { current: false, reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", basisDigest: row.basis_digest };
}

export async function readCurrentAccountAuthorityV1(
  sql: postgres.Sql,
  organizationId: string,
  accountId: string,
): Promise<CurrentAccountAuthorityV1> {
  const rows = await sql<{ basis_digest: string | null }[]>`
    select basis_digest from trader_risk_account_current_v1
    where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
  return classifyCurrentAccountRowV1(rows[0] ?? null);
}
