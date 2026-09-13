import "server-only";
import type { Sql } from "postgres";

export type ObservationPoolPurpose = "collector" | "reader";
export const observationPoolLimits = Object.freeze({ max: 2, connect_timeout: 3,
  max_lifetime: 300, prepare: false as const });
const fail = (): never => { throw new Error("OBSERVATION_HOST_ROLE_REFUSED"); };

/** Bounded session/role attestation, not provisioning or a cluster-wide privilege audit.
 * No secrets are selected. Runtime transactions still SET ROLE and scope every query.
 * SQL factories are trusted driver providers; arbitrary fabricated Sql implementations
 * cannot be authenticated by a TypeScript interface and are not an admission mechanism.
 */
export async function probeObservationPool(sql: Sql, purpose: ObservationPoolPurpose): Promise<string> {
  try {
    const options = sql?.options;
    if (typeof sql !== "function" || typeof sql.begin !== "function" || !options ||
      options.prepare !== false || !Number.isSafeInteger(options.max) || options.max < 1 || options.max > 2 ||
      typeof options.connect_timeout !== "number" || options.connect_timeout < 1 || options.connect_timeout > 3 ||
      typeof options.max_lifetime !== "number" || options.max_lifetime < 1 || options.max_lifetime > 300) fail();
    const role = purpose === "collector" ? "waia_account_observer" : "waia_account_observation_reader";
    const result = await sql.begin(async tx => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      await tx`SET LOCAL lock_timeout = '1000ms'`;
      await tx`SET LOCAL transaction_timeout = '5000ms'`;
      return tx`
        SELECT session_user::text AS login,
          current_user = session_user AS original_session,
          current_setting('server_version_num')::int >= 170000 AS supported,
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolcanlogin
            AND NOT (rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) AS safe_login,
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role} AND NOT
            (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) AS safe_role,
          pg_has_role(session_user, ${role}, 'SET') AS can_set,
          NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname NOT IN (session_user, ${role})
            AND pg_has_role(session_user, oid, 'SET')) AS exclusive_role,
          NOT EXISTS (SELECT 1 FROM unnest(ARRAY[session_user::text, ${role}]) AS r(name)
            CROSS JOIN unnest(ARRAY['encrypted_payload', 'wrapped_dek_key']) AS c(name)
            WHERE has_column_privilege(r.name, 'public.exchange_credentials', c.name, 'SELECT')) AS no_ciphertext,
          NOT EXISTS (SELECT 1 FROM unnest(ARRAY[session_user::text, ${role}]) AS r(name)
            CROSS JOIN unnest(ARRAY['public.trader_account_collection_state', 'public.trader_account_observations']) AS t(name)
            WHERE has_table_privilege(r.name, t.name, 'DELETE,TRUNCATE')) AS no_destructive,
          (${purpose} <> 'reader' OR NOT EXISTS (
            SELECT 1 FROM unnest(ARRAY[session_user::text, ${role}]) AS r(name)
            CROSS JOIN unnest(ARRAY['public.exchange_credentials', 'public.trader_account_collection_state',
              'public.trader_account_observations']) AS t(name)
            WHERE has_any_column_privilege(r.name, t.name, 'INSERT,UPDATE')
              OR has_table_privilege(r.name, t.name, 'DELETE,TRUNCATE'))) AS reader_no_writes,
          (SELECT count(*) = 2 AND bool_and(relrowsecurity AND relforcerowsecurity)
            FROM pg_class WHERE oid IN ('public.trader_account_collection_state'::regclass,
              'public.trader_account_observations'::regclass)) AS forced_rls
      `;
    });
    const row = result[0];
    if (result.length !== 1 || !row || typeof row.login !== "string" || !row.login ||
      ["original_session", "supported", "safe_login", "safe_role", "can_set", "exclusive_role",
        "no_ciphertext", "no_destructive", "reader_no_writes", "forced_rls"].some(name => row[name] !== true)) fail();
    return row.login;
  } catch { return fail(); }
}
