import type postgres from "postgres";

export const HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2 =
  "waia_historical_runner" as const;
export const HISTORICAL_SIMULATION_RUNNER_LOGIN_ROLE_V2 =
  "waia_historical_runner_login" as const;

/**
 * The production consumer must authenticate as the dedicated constrained LOGIN.
 * Merely succeeding at SET ROLE is insufficient because an owner/superuser URI
 * could do that while retaining a far wider session authority.
 */
export async function requireHistoricalSimulationRunnerLoginV2(
  sql: postgres.Sql,
): Promise<void> {
  const rows = await sql<Array<Readonly<{
    session_user: string;
    current_user: string;
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolconnlimit: number;
    owns_current_database: boolean;
    has_direct_grants: boolean;
    owns_objects: boolean;
    memberships: string[];
  }>>>`
    SELECT session_user::text AS session_user,
           current_user::text AS current_user,
           login.rolcanlogin,
           login.rolinherit,
           login.rolsuper,
           login.rolcreatedb,
           login.rolcreaterole,
           login.rolreplication,
           login.rolbypassrls,
           login.rolconnlimit,
           database.datdba = login.oid AS owns_current_database,
           EXISTS (
             SELECT 1 FROM pg_shdepend dependency
             WHERE dependency.refclassid = 'pg_authid'::regclass
               AND dependency.refobjid = login.oid
               AND dependency.deptype = 'a'
           ) AS has_direct_grants,
           EXISTS (
             SELECT 1 FROM pg_shdepend dependency
             WHERE dependency.refclassid = 'pg_authid'::regclass
               AND dependency.refobjid = login.oid
               AND dependency.deptype = 'o'
           ) AS owns_objects,
           COALESCE((
             SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
             FROM pg_auth_members membership
             JOIN pg_roles parent ON parent.oid = membership.roleid
             WHERE membership.member = login.oid
           ), ARRAY[]::text[]) AS memberships
    FROM pg_roles login
    JOIN pg_database database ON database.datname = current_database()
    WHERE login.rolname = session_user
  `;
  const row = rows[0];
  if (rows.length !== 1 ||
      row?.session_user !== HISTORICAL_SIMULATION_RUNNER_LOGIN_ROLE_V2 ||
      row.current_user !== HISTORICAL_SIMULATION_RUNNER_LOGIN_ROLE_V2 ||
      row.rolcanlogin !== true || row.rolinherit !== false || row.rolsuper !== false ||
      row.rolcreatedb !== false || row.rolcreaterole !== false ||
      row.rolreplication !== false || row.rolbypassrls !== false ||
      row.rolconnlimit !== 2 || row.owns_current_database !== false ||
      row.has_direct_grants !== false || row.owns_objects !== false ||
      row.memberships.length !== 1 ||
      row.memberships[0] !== HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_LOGIN_ROLE");
  }
}

/** Fail-closed session downgrade shared by bootstrap, queue and execution. */
export async function assumeHistoricalSimulationRunnerRoleV2(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe(`SET ROLE ${HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2}`);
  const rows = await sql<Array<Readonly<{ current_user: string }>>>`
    SELECT current_user::text AS current_user
  `;
  if (rows.length !== 1 ||
      rows[0]?.current_user !== HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2) {
    try { await sql.unsafe("RESET ROLE"); } catch { /* close is the final fallback */ }
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_ROLE");
  }
}

export async function resetHistoricalSimulationRunnerRoleV2(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe("RESET ROLE");
}

/**
 * Returns the current member role only when the operator is bound through the
 * exact durable request -> proposal -> Human approval chain for this run.
 * The runner has no direct SELECT privilege on organization_members.
 */
export async function requireHistoricalApprovedOperatorRoleV2(
  sql: postgres.Sql,
  input: Readonly<{
    organizationId: string;
    runId: string;
    releaseSha: string;
    operatorUserId: string;
  }>,
): Promise<"owner" | "manager"> {
  const rows = await sql<Array<Readonly<{ member_role: string | null }>>>`
    SELECT public.waia_historical_approved_operator_role_v2(
      ${input.organizationId}::uuid,
      ${input.runId},
      ${input.releaseSha},
      ${input.operatorUserId}::uuid
    ) AS member_role
  `;
  const role = rows[0]?.member_role;
  if (rows.length !== 1 || (role !== "owner" && role !== "manager")) {
    throw new Error(
      "HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:APPROVED_OPERATOR_MEMBERSHIP",
    );
  }
  return role;
}
