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

const credentialLogin = "waia_account_observation_credential_login";
const credentialRole = "waia_account_observation_credential";
const refuseCredential = (): never => { throw new Error("OBSERVATION_CREDENTIAL_ROLE_REFUSED"); };

/** Startup admission for the private credential pool, before provider initialization.
 * This reads catalogs only, through the actual restricted session. It neither grants
 * privileges nor attests policy definitions/continuous drift. Database ACL dependencies
 * are excluded as in the provisioner: CONNECT and TEMP are not data authority here;
 * effective permanent CREATE is checked separately. Parent projection grants are expected.
 */
export async function probeObservationCredentialPool(sql: Sql): Promise<string> {
  try {
    const options = sql?.options;
    if (typeof sql !== "function" || typeof sql.begin !== "function" || !options ||
      options.prepare !== false || !Number.isSafeInteger(options.max) || options.max < 1 || options.max > 2 ||
      !Number.isFinite(options.connect_timeout) || typeof options.connect_timeout !== "number" || options.connect_timeout < 1 || options.connect_timeout > 3 ||
      !Number.isFinite(options.max_lifetime) || typeof options.max_lifetime !== "number" || options.max_lifetime < 1 || options.max_lifetime > 300) refuseCredential();
    const rows = await sql.begin(async tx => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      await tx`SET LOCAL lock_timeout = '1000ms'`;
      await tx`SET LOCAL transaction_timeout = '5000ms'`;
      return tx`
        WITH identities AS (
          SELECT login.oid AS login_oid, parent.oid AS parent_oid,
            login.rolcanlogin AND NOT (login.rolinherit OR login.rolsuper OR login.rolbypassrls
              OR login.rolcreatedb OR login.rolcreaterole OR login.rolreplication)
              AND login.rolconnlimit = 2 AS safe_login,
            NOT (parent.rolcanlogin OR parent.rolinherit OR parent.rolsuper OR parent.rolbypassrls
              OR parent.rolcreatedb OR parent.rolcreaterole OR parent.rolreplication)
              AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = parent.oid) AS safe_role
          FROM pg_roles login CROSS JOIN pg_roles parent
          WHERE login.rolname = session_user AND parent.rolname = ${credentialRole}
        ), scopes AS (
          SELECT login_oid AS oid FROM identities UNION ALL SELECT parent_oid FROM identities
        ), protected AS (
          SELECT 'public.exchange_credentials'::regclass AS oid,
            ARRAY['id','organization_id','exchange_account_id','status','observation_read_only','observation_read_permitted',
              'encrypted_payload','payload_key_version','wrapped_dek_key_version','wrapped_dek_key',
              'observation_revision']::text[] AS allowed
          UNION ALL SELECT 'public.trader_account_collection_state'::regclass,
            ARRAY['organization_id','credential_id','exchange_account_id','configuration_revision']::text[]
          UNION ALL SELECT 'public.trader_account_observations'::regclass, ARRAY[]::text[]
        )
        SELECT session_user::text AS login, current_user = session_user AS original_session,
          current_setting('server_version_num')::int >= 170000 AS supported,
          i.safe_login, i.safe_role,
          (SELECT count(*) = 1 AND bool_and(m.roleid = i.parent_oid AND NOT m.admin_option
            AND NOT m.inherit_option AND m.set_option)
            FROM pg_auth_members m WHERE m.member = i.login_oid) AS membership,
          pg_has_role(i.login_oid, i.parent_oid, 'SET') AND NOT EXISTS (
            SELECT 1 FROM pg_roles r WHERE r.oid NOT IN (i.login_oid, i.parent_oid)
              AND pg_has_role(i.login_oid, r.oid, 'SET')) AS exclusive_role,
          NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass
            AND d.refobjid = i.login_oid AND d.deptype = 'a'
            AND d.classid <> 'pg_database'::regclass) AS no_direct_acl,
          NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass
            AND d.refobjid IN (i.login_oid, i.parent_oid) AND d.deptype = 'o')
            AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database()
              AND d.datdba IN (i.login_oid, i.parent_oid)) AS no_ownership,
          NOT EXISTS (SELECT 1 FROM scopes s WHERE
            has_database_privilege(s.oid, current_database(), 'CREATE')
            OR has_schema_privilege(s.oid, 'public', 'CREATE')) AS no_create,
          NOT EXISTS (SELECT 1 FROM scopes s CROSS JOIN protected p WHERE
            has_table_privilege(s.oid, p.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
            OR has_any_column_privilege(s.oid, p.oid, 'INSERT,UPDATE,REFERENCES'))
          AND NOT EXISTS (SELECT 1 FROM scopes s CROSS JOIN protected p
            JOIN pg_attribute a ON a.attrelid = p.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE NOT (a.attname = ANY(p.allowed)) AND has_column_privilege(s.oid, p.oid, a.attnum, 'SELECT'))
          AND NOT EXISTS (SELECT 1 FROM protected p CROSS JOIN LATERAL unnest(p.allowed) AS c(name)
            WHERE NOT has_column_privilege(i.parent_oid, p.oid, c.name, 'SELECT')) AS exact_projection,
          (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND
            (c.oid <> 'public.trader_account_collection_state'::regclass OR c.relforcerowsecurity))
            FROM pg_class c WHERE c.oid IN ('public.exchange_credentials'::regclass,
              'public.trader_account_collection_state'::regclass)) AS rls
        FROM identities i
      `;
    });
    const row = rows[0];
    if (rows.length !== 1 || !row || row.login !== credentialLogin ||
      ["original_session", "supported", "safe_login", "safe_role", "membership", "exclusive_role",
        "no_direct_acl", "no_ownership", "no_create", "exact_projection", "rls"].some(key => row[key] !== true)) refuseCredential();
    return row.login;
  } catch { return refuseCredential(); }
}
