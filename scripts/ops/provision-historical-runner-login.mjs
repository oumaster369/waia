#!/usr/bin/env node
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const LOGIN_ROLE = "waia_historical_runner_login";
const RUNNER_ROLE = "waia_historical_runner";
const ITERATIONS = 4096;

function requireUnprivilegedRole(role, code) {
  if (!role || ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"]
    .some((flag) => role[flag] !== false)) {
    throw new Error(`HISTORICAL_RUNNER_LOGIN_REFUSED:${code}`);
  }
}

export function buildPostgresScramVerifier(password, salt = randomBytes(16)) {
  if (typeof password !== "string" || password.length < 32) {
    throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:PASSWORD_STRENGTH");
  }
  const saltedPassword = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key").digest("base64");
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}

export async function provisionHistoricalRunnerLoginV2(env, options = {}) {
  const adminUrl = env.WAIA_POSTGRES_ADMIN_SESSION_URL?.trim();
  const password = env.WAIA_HISTORICAL_RUNNER_DB_PASSWORD;
  if (!adminUrl || !/^postgres(?:ql)?:\/\//i.test(adminUrl)) {
    throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:ADMIN_SESSION_URL");
  }
  const verifier = buildPostgresScramVerifier(password);
  const open = options.openDatabase ?? ((url) => postgres(url, {
    max: 1, idle_timeout: 20, connect_timeout: 15,
  }));
  const pool = open(adminUrl);
  try {
    await pool.begin("ISOLATION LEVEL SERIALIZABLE", async (sql) => {
      const authority = await sql`
        SELECT r.rolsuper, r.rolcreaterole
        FROM pg_roles r
        WHERE r.rolname = current_user
      `;
      if (authority.length !== 1 ||
          (!authority[0]?.rolsuper && !authority[0]?.rolcreaterole)) {
        throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:ADMIN_ROLE");
      }
      const runnerBefore = await sql`
        SELECT role.rolsuper, role.rolcreatedb, role.rolcreaterole,
               role.rolreplication, role.rolbypassrls
        FROM pg_roles role WHERE role.rolname = ${RUNNER_ROLE}
      `;
      requireUnprivilegedRole(runnerBefore[0], "RUNNER_PRIVILEGED");
      // Do not specify restricted privilege attributes in ALTER ROLE: managed
      // administrators cannot set NOSUPERUSER even when it is already false.
      await sql.unsafe(`ALTER ROLE ${RUNNER_ROLE} NOLOGIN NOINHERIT CONNECTION LIMIT -1`);
      const runner = await sql`
        SELECT role.rolcanlogin, role.rolinherit, role.rolsuper, role.rolcreatedb,
               role.rolcreaterole, role.rolreplication, role.rolbypassrls,
               COALESCE((
                 SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
                 FROM pg_auth_members membership
                 JOIN pg_roles parent ON parent.oid = membership.roleid
                 WHERE membership.member = role.oid
               ), ARRAY[]::text[]) AS memberships
        FROM pg_roles role WHERE role.rolname = ${RUNNER_ROLE}
      `;
      const runnerRole = runner[0];
      if (runner.length !== 1 || runnerRole?.rolcanlogin !== false ||
          runnerRole.rolinherit !== false || runnerRole.rolsuper !== false ||
          runnerRole.rolcreatedb !== false || runnerRole.rolcreaterole !== false ||
          runnerRole.rolreplication !== false || runnerRole.rolbypassrls !== false ||
          runnerRole.memberships.length !== 0) {
        throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:RUNNER_ROLE");
      }
      const existing = await sql`
        SELECT login.oid::text AS oid, login.rolsuper, login.rolcreatedb,
               login.rolcreaterole, login.rolreplication, login.rolbypassrls,
               EXISTS (
                 SELECT 1 FROM pg_auth_members membership
                 WHERE membership.member=login.oid AND
                   (membership.admin_option OR membership.inherit_option OR NOT membership.set_option)
               ) AS unsafe_membership_options,
               COALESCE((
                 SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
                 FROM pg_auth_members membership
                 JOIN pg_roles parent ON parent.oid = membership.roleid
                 WHERE membership.member = login.oid
               ), ARRAY[]::text[]) AS memberships,
               EXISTS (
                 SELECT 1 FROM pg_shdepend dependency
                 WHERE dependency.refclassid='pg_authid'::regclass
                   AND dependency.refobjid=login.oid AND dependency.deptype='a'
               ) AS has_direct_grants,
               EXISTS (
                 SELECT 1 FROM pg_shdepend dependency
                 WHERE dependency.refclassid='pg_authid'::regclass
                   AND dependency.refobjid=login.oid AND dependency.deptype='o'
               ) AS owns_objects
        FROM pg_roles login WHERE login.rolname = ${LOGIN_ROLE}
      `;
      if (existing.length > 0) {
        requireUnprivilegedRole(existing[0], "LOGIN_PRIVILEGED");
        if (existing[0].memberships.some((roleName) => roleName !== RUNNER_ROLE)) {
          throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:UNEXPECTED_MEMBERSHIP");
        }
        if (existing[0].unsafe_membership_options !== false) {
          throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:MEMBERSHIP_OPTIONS");
        }
        if (existing[0].has_direct_grants) {
          throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:DIRECT_GRANT");
        }
        if (existing[0].owns_objects) {
          throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:OBJECT_OWNERSHIP");
        }
      } else {
        await sql.unsafe(
          `CREATE ROLE ${LOGIN_ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB ` +
          "NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2",
        );
      }
      // Only the SCRAM verifier, never the plaintext password, enters SQL/logging.
      await sql.unsafe(
        `ALTER ROLE ${LOGIN_ROLE} LOGIN NOINHERIT CONNECTION LIMIT 2 PASSWORD '${verifier}'`,
      );
      await sql.unsafe(
        `GRANT ${RUNNER_ROLE} TO ${LOGIN_ROLE} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
      );
      const verified = await sql`
        SELECT login.rolcanlogin, login.rolinherit, login.rolsuper, login.rolcreatedb,
               login.rolcreaterole, login.rolreplication, login.rolbypassrls,
               login.rolconnlimit,
               EXISTS (
                 SELECT 1 FROM pg_auth_members membership
                 WHERE membership.member=login.oid AND
                   (membership.admin_option OR membership.inherit_option OR NOT membership.set_option)
               ) AS unsafe_membership_options,
               database.datdba=login.oid AS owns_current_database,
               COALESCE((
                 SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
                 FROM pg_auth_members membership
                 JOIN pg_roles parent ON parent.oid=membership.roleid
                 WHERE membership.member=login.oid
               ), ARRAY[]::text[]) AS memberships,
               EXISTS (
                 SELECT 1 FROM pg_shdepend dependency
                 WHERE dependency.refclassid='pg_authid'::regclass
                   AND dependency.refobjid=login.oid AND dependency.deptype='a'
               ) AS has_direct_grants,
               EXISTS (
                 SELECT 1 FROM pg_shdepend dependency
                 WHERE dependency.refclassid='pg_authid'::regclass
                   AND dependency.refobjid=login.oid AND dependency.deptype='o'
               ) AS owns_objects
        FROM pg_roles login
        JOIN pg_database database ON database.datname=current_database()
        WHERE login.rolname=${LOGIN_ROLE}
      `;
      const posture = verified[0];
      if (verified.length !== 1 || posture?.rolcanlogin !== true ||
          posture.rolinherit !== false || posture.rolsuper !== false ||
          posture.rolcreatedb !== false || posture.rolcreaterole !== false ||
          posture.rolreplication !== false || posture.rolbypassrls !== false ||
          posture.rolconnlimit !== 2 || posture.owns_current_database !== false ||
          posture.unsafe_membership_options !== false ||
          posture.has_direct_grants !== false || posture.owns_objects !== false ||
          posture.memberships.length !== 1 || posture.memberships[0] !== RUNNER_ROLE) {
        throw new Error("HISTORICAL_RUNNER_LOGIN_REFUSED:POSTURE");
      }
    });
    return Object.freeze({ loginRole: LOGIN_ROLE, memberOf: RUNNER_ROLE });
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
      "historical-runner login provisioning: NO-OP (missing --confirm)\n",
    );
  } else {
    const result = await provisionHistoricalRunnerLoginV2(process.env);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "waia.historical_runner_login_provisioning.v2",
      status: "OK",
      ...result,
    })}\n`);
  }
}
