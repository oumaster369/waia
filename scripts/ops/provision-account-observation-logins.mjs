#!/usr/bin/env node
/**
 * DEE-1015: bounded Human-only provisioning of the three account-observation runtime LOGIN
 * identities. It creates LOGIN identities only, and derives all data authority from exact
 * membership in the NOLOGIN parent roles established by migrations 0205 and 0210.
 *
 * It grants no privilege directly to any LOGIN, creates no schema object, owns nothing, and never
 * touches historical-plane, execution, order, billing or admin authority. The SCRAM verifier
 * construction follows the proven posture of `provision-historical-runner-login.mjs`; no
 * historical semantics, role or refusal vocabulary is imported.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const ITERATIONS = 4096;
const CONNECTION_LIMIT = 2;
export const RECEIPT_SCHEMA = "waia.account_observation_login_provisioning.v1";

/** Exact login -> NOLOGIN parent authority mapping. Order is the runtime open order. */
export const ACCOUNT_OBSERVATION_LOGIN_PLAN = Object.freeze([
  Object.freeze({
    purpose: "collector",
    loginRole: "waia_account_observer_login",
    parentRole: "waia_account_observer",
    passwordEnv: "WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD",
  }),
  Object.freeze({
    purpose: "reader",
    loginRole: "waia_account_observation_reader_login",
    parentRole: "waia_account_observation_reader",
    passwordEnv: "WAIA_OBSERVATION_READER_DB_PASSWORD",
  }),
  Object.freeze({
    purpose: "credential",
    loginRole: "waia_account_observation_credential_login",
    parentRole: "waia_account_observation_credential",
    passwordEnv: "WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD",
  }),
]);

const PRIVILEGE_FLAGS = Object.freeze([
  "rolsuper",
  "rolcreatedb",
  "rolcreaterole",
  "rolreplication",
  "rolbypassrls",
]);

function refuse(code) {
  return new Error(`ACCOUNT_OBSERVATION_LOGIN_REFUSED:${code}`);
}

/** Only the SCRAM verifier reaches SQL; the plaintext password never does and is never logged. */
export function buildPostgresScramVerifier(password, salt = randomBytes(16)) {
  if (typeof password !== "string" || password.length < 32) {
    throw refuse("PASSWORD_STRENGTH");
  }
  const saltedPassword = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}

/** ALTER ROLE is a utility statement and cannot bind parameters, so the verifier is checked
 * against its exact SCRAM grammar before it is ever interpolated. */
const SCRAM_VERIFIER =
  /^SCRAM-SHA-256\$\d{1,10}:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

function quoteVerifier(verifier) {
  if (typeof verifier !== "string" || !SCRAM_VERIFIER.test(verifier)) {
    throw refuse("VERIFIER_FORMAT");
  }
  return `'${verifier}'`;
}

function requireUnprivileged(role, code) {
  if (!role || PRIVILEGE_FLAGS.some((flag) => role[flag] !== false)) {
    throw refuse(code);
  }
}

const ROLE_NAME = /^[a-z][a-z0-9_]{2,62}$/;

function quoteRole(name) {
  if (!ROLE_NAME.test(name)) throw refuse("ROLE_NAME");
  return `"${name}"`;
}

async function readParent(sql, parentRole) {
  const rows = await sql`
    SELECT parent.rolcanlogin, parent.rolsuper, parent.rolcreatedb, parent.rolcreaterole,
           parent.rolreplication, parent.rolbypassrls,
           COALESCE((
             SELECT array_agg(grandparent.rolname::text ORDER BY grandparent.rolname)
             FROM pg_auth_members membership
             JOIN pg_roles grandparent ON grandparent.oid = membership.roleid
             WHERE membership.member = parent.oid
           ), ARRAY[]::text[]) AS memberships
    FROM pg_roles parent WHERE parent.rolname = ${parentRole}
  `;
  if (rows.length !== 1) throw refuse("PARENT_ABSENT");
  const parent = rows[0];
  requireUnprivileged(parent, "PARENT_PRIVILEGED");
  if (parent.rolcanlogin !== false) throw refuse("PARENT_CAN_LOGIN");
  // A parent that inherits nothing cannot smuggle authority into the login, so 0205's
  // observer role (created without NOINHERIT) stays lawful without being altered here.
  if (parent.memberships.length !== 0) throw refuse("PARENT_MEMBERSHIP");
  return parent;
}

const LOGIN_POSTURE = (alias) => `
  ${alias}.rolcanlogin, ${alias}.rolinherit, ${alias}.rolsuper, ${alias}.rolcreatedb,
  ${alias}.rolcreaterole, ${alias}.rolreplication, ${alias}.rolbypassrls, ${alias}.rolconnlimit,
  EXISTS (
    SELECT 1 FROM pg_auth_members membership
    WHERE membership.member = ${alias}.oid
      AND (membership.admin_option OR membership.inherit_option OR NOT membership.set_option)
  ) AS unsafe_membership_options,
  COALESCE((
    SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    WHERE membership.member = ${alias}.oid
  ), ARRAY[]::text[]) AS memberships,
  EXISTS (
    SELECT 1 FROM pg_shdepend dependency
    WHERE dependency.refclassid = 'pg_authid'::regclass
      AND dependency.refobjid = ${alias}.oid AND dependency.deptype = 'a'
      AND dependency.classid <> 'pg_database'::regclass
  ) AS has_direct_grants,
  has_database_privilege(${alias}.oid, current_database(), 'CREATE') AS can_create_in_database,
  EXISTS (
    SELECT 1 FROM pg_shdepend dependency
    WHERE dependency.refclassid = 'pg_authid'::regclass
      AND dependency.refobjid = ${alias}.oid AND dependency.deptype = 'o'
  ) AS owns_objects
`;

async function provisionOne(sql, entry, verifier) {
  const login = quoteRole(entry.loginRole);
  const parent = quoteRole(entry.parentRole);
  if (entry.loginRole === entry.parentRole) throw refuse("LOGIN_NOT_SEPARATE");
  await readParent(sql, entry.parentRole);

  const existing = await sql.unsafe(
    `SELECT ${LOGIN_POSTURE("login")} FROM pg_roles login WHERE login.rolname = $1`,
    [entry.loginRole],
  );
  if (existing.length > 0) {
    const current = existing[0];
    requireUnprivileged(current, "LOGIN_PRIVILEGED");
    if (current.memberships.some((name) => name !== entry.parentRole)) {
      throw refuse("UNEXPECTED_MEMBERSHIP");
    }
    if (current.unsafe_membership_options !== false) throw refuse("MEMBERSHIP_OPTIONS");
    // Database CONNECT is deployment connectivity, not data authority, and is the only ACL
    // dependency tolerated: any table, column, schema or function grant is refused so parent
    // membership stays the single source of this identity's data privileges.
    if (current.has_direct_grants) throw refuse("DIRECT_GRANT");
    if (current.can_create_in_database) throw refuse("DATABASE_CREATE");
    if (current.owns_objects) throw refuse("OBJECT_OWNERSHIP");
  } else {
    await sql.unsafe(
      `CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
        `NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${CONNECTION_LIMIT}`,
    );
  }
  // Restricted attributes are omitted from ALTER ROLE on purpose: managed administrators cannot
  // restate NOSUPERUSER/NOBYPASSRLS even when already false. They are verified below instead.
  await sql.unsafe(
    `ALTER ROLE ${login} LOGIN NOINHERIT CONNECTION LIMIT ${CONNECTION_LIMIT} ` +
      `PASSWORD ${quoteVerifier(verifier)}`,
  );
  await sql.unsafe(`GRANT ${parent} TO ${login} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);

  const verified = await sql.unsafe(
    `SELECT ${LOGIN_POSTURE("login")}, database.datdba = login.oid AS owns_current_database
     FROM pg_roles login JOIN pg_database database ON database.datname = current_database()
     WHERE login.rolname = $1`,
    [entry.loginRole],
  );
  const posture = verified[0];
  if (
    verified.length !== 1 ||
    posture?.rolcanlogin !== true ||
    posture.rolinherit !== false ||
    posture.rolsuper !== false ||
    posture.rolcreatedb !== false ||
    posture.rolcreaterole !== false ||
    posture.rolreplication !== false ||
    posture.rolbypassrls !== false ||
    posture.rolconnlimit !== CONNECTION_LIMIT ||
    posture.owns_current_database !== false ||
    posture.unsafe_membership_options !== false ||
    posture.has_direct_grants !== false ||
    posture.can_create_in_database !== false ||
    posture.owns_objects !== false ||
    posture.memberships.length !== 1 ||
    posture.memberships[0] !== entry.parentRole
  ) {
    throw refuse("POSTURE");
  }
  return Object.freeze({
    purpose: entry.purpose,
    loginRole: entry.loginRole,
    parentRole: entry.parentRole,
    connectionLimit: CONNECTION_LIMIT,
    created: existing.length === 0,
  });
}

export async function provisionAccountObservationLoginsV1(env, options = {}) {
  const adminUrl = env.WAIA_POSTGRES_ADMIN_SESSION_URL?.trim();
  if (!adminUrl || !/^postgres(?:ql)?:\/\//i.test(adminUrl)) {
    throw refuse("ADMIN_SESSION_URL");
  }
  // The CLI always provisions the canonical plan; an explicit plan exists so adversarial
  // qualification can exercise refusals against sandbox roles instead of runtime identities.
  const plan = options.plan ?? ACCOUNT_OBSERVATION_LOGIN_PLAN;
  if (
    !Array.isArray(plan) ||
    plan.length < 1 ||
    plan.some(
      (entry) =>
        typeof entry?.loginRole !== "string" ||
        typeof entry?.parentRole !== "string" ||
        typeof entry?.passwordEnv !== "string",
    )
  ) {
    throw refuse("PLAN");
  }
  // Every verifier is derived before any connection opens, so a weak or missing password
  // cannot leave the cluster partially provisioned.
  const verifiers = plan.map((entry) => buildPostgresScramVerifier(env[entry.passwordEnv]));
  const distinct = new Set(plan.map((entry) => env[entry.passwordEnv]));
  if (distinct.size !== plan.length) throw refuse("PASSWORD_REUSE");

  const open =
    options.openDatabase ??
    // Notices are suppressed: PostgreSQL echoes the full role graph on a repeat GRANT.
    ((url) => postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} }));
  const pool = open(adminUrl);
  try {
    const logins = await pool.begin("ISOLATION LEVEL SERIALIZABLE", async (sql) => {
      const authority = await sql`
        SELECT admin.rolsuper, admin.rolcreaterole
        FROM pg_roles admin WHERE admin.rolname = current_user
      `;
      if (authority.length !== 1 || (!authority[0]?.rolsuper && !authority[0]?.rolcreaterole)) {
        throw refuse("ADMIN_ROLE");
      }
      // The provisioning session must never be one of the identities it provisions, nor any
      // canonical observation runtime role.
      const runtime = await sql`
        SELECT current_user::text = ANY (${ACCOUNT_OBSERVATION_LOGIN_PLAN.flatMap((entry) => [
          entry.loginRole,
          entry.parentRole,
        ]).concat(plan.flatMap((entry) => [entry.loginRole, entry.parentRole]))}::text[])
          AS is_runtime
      `;
      if (runtime[0]?.is_runtime !== false) throw refuse("ADMIN_IS_RUNTIME_ROLE");

      const provisioned = [];
      for (const [index, entry] of plan.entries()) {
        provisioned.push(await provisionOne(sql, entry, verifiers[index]));
      }
      return provisioned;
    });
    return Object.freeze({ schemaVersion: RECEIPT_SCHEMA, status: "OK", logins });
  } finally {
    await pool.end({ timeout: 5 });
  }
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (!process.argv.includes("--confirm")) {
    process.stderr.write(
      "account-observation login provisioning: NO-OP (missing --confirm)\n" +
        `expected identities: ${ACCOUNT_OBSERVATION_LOGIN_PLAN.map(
          (entry) => `${entry.loginRole} -> ${entry.parentRole}`,
        ).join(", ")}\n`,
    );
    process.exitCode = 1;
  } else {
    const receipt = await provisionAccountObservationLoginsV1(process.env);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
}
