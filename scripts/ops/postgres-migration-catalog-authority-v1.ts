/**
 * DEE-1020: canonical authority projection shared by the H2 (0205–0208) and post-H2 (0209–0210)
 * PostgreSQL migration operators.
 *
 * Both operators freeze an exhaustive catalog digest per step. Those digests were derived against a
 * bare PostgreSQL cluster whose migration authority is the bootstrap superuser and whose `public`
 * schema carries only PostgreSQL's stock ACL. The approved WAIA production target is a managed
 * Supabase project, and three properties of that *cluster class* — not of one project — make raw
 * ACL and membership rows unusable as a frozen identity:
 *
 *   1. `ALTER DEFAULT PRIVILEGES` gives `anon`, `authenticated` and `service_role` a fixed
 *      structural privilege set (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on every newly created
 *      relation in `public`, and pre-existing relations carry the same set.
 *   2. Those principals plus the migration authority hold explicit `public` USAGE.
 *   3. The migration authority is a NOSUPERUSER CREATEROLE role, so PostgreSQL 16+ automatically
 *      grants every role it creates back to it `WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
 *      recording a platform-specific grantor. A superuser authority produces no such row.
 *
 * The fix is deliberately NOT "filter grants to an allowlist of principals". Filtering by principal
 * is what would hide dangerous authority, and the existing H2 `grantees` lists already contain
 * `anon` and `authenticated`, so it would not even remove the divergence. Instead this module
 * partitions privileges by *class* and keeps the dangerous classes digest-pinned for every
 * principal without exception:
 *
 *   • DATA authority (SELECT/INSERT/UPDATE/DELETE, table and column level) is what reads secrets
 *     and mutates rows. It stays inside the frozen digest for every grantee, including
 *     `service_role` — which carries BYPASSRLS on Supabase and would therefore read every row of
 *     any relation it were ever granted SELECT on. A Supabase-class default ACL grants none of
 *     these classes, and the bare harness grants none either, so both cluster classes converge
 *     without concealing anything.
 *   • Schema CREATE stays digest-pinned AND is refused outright for every non-owner principal.
 *   • The structural classes and schema USAGE are removed from the digest only in exchange for
 *     fail-closed closure assertions: an unknown principal, an unknown privilege class, a
 *     structural privilege held by a non-platform principal, or any grantable privilege is
 *     refused. Nothing becomes invisible; it becomes explicitly bounded instead.
 *
 * No project id, hostname, database name or instance identity is consulted anywhere in this module.
 * The distinction it draws is between privilege classes and between declared principal roles, both
 * of which are properties of the migration contract itself.
 */
import type { Sql } from "postgres";

/**
 * Privilege classes that can read or mutate data. Always digest-pinned, for every grantee.
 * `information_schema` reports exactly these names, as does `aclexplode`.
 */
export const WAIA_DATA_AUTHORITY_PRIVILEGES: readonly string[] = Object.freeze([
  "DELETE",
  "INSERT",
  "SELECT",
  "UPDATE",
]);

/**
 * Structural classes a Supabase-class cluster grants to platform principals on every relation in
 * `public`. None of them reads a column or writes a row. They are excluded from the digest only
 * under `assertRelationAuthorityBounded`'s closure rules, never by principal name.
 *
 * TRUNCATE is destructive and TRIGGER is a real capability, so they are NOT claimed to be harmless:
 * they are a pre-existing, schema-wide platform posture that predates every migration in this
 * campaign and applies uniformly to all ~200 WAIA relations. Narrowing it is a separate Human
 * decision about the cluster's default privileges, not something a per-step migration verifier can
 * remediate. What this module guarantees is that the set never grows and never reaches a
 * non-platform principal.
 */
export const PLATFORM_BASELINE_TABLE_PRIVILEGES: readonly string[] = Object.freeze([
  "MAINTAIN",
  "REFERENCES",
  "TRIGGER",
  "TRUNCATE",
]);

/** Principals a Supabase-class platform bootstrap manages. Never a WAIA contract principal. */
export const PLATFORM_MANAGED_PRINCIPALS: readonly string[] = Object.freeze([
  "anon",
  "authenticated",
  "service_role",
]);

/**
 * Every WAIA role any migration in `db/migrations_postgres` grants `public` USAGE to. USAGE conveys
 * no object access on its own — it is the prerequisite for the column and table grants that ARE
 * digest-pinned — so admitting exactly this closed set keeps the schema projection portable while
 * still refusing an unknown principal.
 */
export const WAIA_SCHEMA_USAGE_PRINCIPALS: readonly string[] = Object.freeze([
  "waia_account_observation_credential",
  "waia_account_observation_reader",
  "waia_account_observer",
  "waia_historical_runner",
]);

/** Grantee tokens this module substitutes for the verified migration authority and object owners. */
const AUTHORITY_TOKENS: readonly string[] = Object.freeze([
  "CURRENT_USER",
  "RELATION_OWNER",
  "SCHEMA_OWNER",
]);

/** Each lane keeps its own refusal vocabulary; this module never invents a second one. */
export type CatalogRefusal = (code: string, detail: string) => never;

export type RelationAuthorityRow = Readonly<{
  relation_name: string;
  grantee_name: string;
  privilege_type: string;
  is_grantable: boolean;
}>;

type RawRelationPrivilege = RelationAuthorityRow;

type RawColumnPrivilege = Readonly<{
  relation_name: string;
  column_name: string;
  grantee_name: string;
  privilege_type: string;
  is_grantable: boolean;
}>;

function quoted(names: readonly string[], refuse: CatalogRefusal): string {
  if (names.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
    refuse("CATALOG_INTERNAL_NAME", "unsafe verifier identity");
  }
  return names.length > 0 ? names.map((name) => `'${name}'`).join(",") : "''";
}

/**
 * Applies the closure rules that let the structural classes leave the digest. Every rule refuses;
 * none filters. Called for table and column privileges alike.
 */
function assertPrivilegeBounded(
  rows: readonly Readonly<{
    grantee_name: string;
    privilege_type: string;
    is_grantable: boolean;
  }>[],
  declaredPrincipals: readonly string[],
  refuse: CatalogRefusal,
  describe: (row: Readonly<{ grantee_name: string; privilege_type: string }>) => string,
): void {
  const admissible = new Set([
    "PUBLIC",
    ...AUTHORITY_TOKENS,
    ...PLATFORM_MANAGED_PRINCIPALS,
    ...declaredPrincipals,
  ]);
  for (const row of rows) {
    if (!admissible.has(row.grantee_name)) {
      // A principal the migration contract never names holds authority on a covered relation.
      refuse("CATALOG_AUTHORITY_UNKNOWN_PRINCIPAL", describe(row));
    }
    if (
      !WAIA_DATA_AUTHORITY_PRIVILEGES.includes(row.privilege_type) &&
      !PLATFORM_BASELINE_TABLE_PRIVILEGES.includes(row.privilege_type)
    ) {
      // An unclassified privilege class must never be silently dropped from the digest.
      refuse("CATALOG_AUTHORITY_UNKNOWN_PRIVILEGE", describe(row));
    }
    if (
      PLATFORM_BASELINE_TABLE_PRIVILEGES.includes(row.privilege_type) &&
      !PLATFORM_MANAGED_PRINCIPALS.includes(row.grantee_name)
    ) {
      // Only the platform baseline may hold TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. A WAIA role,
      // PUBLIC or anything else holding a destructive class is refused rather than normalized.
      refuse("CATALOG_AUTHORITY_STRUCTURAL_GRANT", describe(row));
    }
    if (row.is_grantable) {
      // WITH GRANT OPTION lets the holder re-delegate. No migration issues one.
      refuse("CATALOG_AUTHORITY_GRANTABLE", describe(row));
    }
  }
}

/**
 * Canonical table and column authority for the relations a step owns.
 *
 * Table privileges come from `aclexplode(relacl)` rather than `information_schema.table_privileges`
 * because `information_schema` omits PostgreSQL 17's MAINTAIN, which would leave that class both
 * out of the digest and out of the closure assertion. Column privileges keep
 * `information_schema.column_privileges`, whose per-column expansion of table-level grants is the
 * coverage the frozen digests were built on.
 */
export async function collectCanonicalRelationAuthority(
  sql: Sql,
  options: Readonly<{
    relations: readonly string[];
    declaredPrincipals: readonly string[];
    refuse: CatalogRefusal;
  }>,
): Promise<
  Readonly<{
    tableAuthorityRows: readonly RelationAuthorityRow[];
    columnAuthorityRows: readonly RawColumnPrivilege[];
  }>
> {
  const { declaredPrincipals, refuse } = options;
  const relations = quoted(options.relations, refuse);
  const tablePrivileges = (await sql.unsafe(`
    SELECT class.relname AS relation_name,
      CASE WHEN privilege.grantee=0 THEN 'PUBLIC'
        WHEN privilege.grantee=class.relowner THEN 'RELATION_OWNER'
        WHEN grantee.rolname=current_user THEN 'CURRENT_USER'
        ELSE grantee.rolname END AS grantee_name,
      privilege.privilege_type,privilege.is_grantable
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class.relacl,acldefault('r',class.relowner))
    ) privilege
    LEFT JOIN pg_roles grantee ON grantee.oid=privilege.grantee
    WHERE namespace.nspname='public' AND class.relname IN (${relations})
    ORDER BY relation_name,grantee_name,privilege.privilege_type
  `)) as unknown as readonly RawRelationPrivilege[];
  const columnPrivileges = (await sql.unsafe(`
    SELECT table_name AS relation_name,column_name,
      CASE WHEN grantee=current_user THEN 'CURRENT_USER' ELSE grantee END AS grantee_name,
      privilege_type,is_grantable='YES' AS is_grantable
    FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name IN (${relations})
    ORDER BY relation_name,column_name,grantee_name,privilege_type
  `)) as unknown as readonly RawColumnPrivilege[];

  const externalTable = tablePrivileges.filter(
    (row) => !AUTHORITY_TOKENS.includes(row.grantee_name),
  );
  const externalColumn = columnPrivileges.filter(
    (row) => !AUTHORITY_TOKENS.includes(row.grantee_name),
  );
  assertPrivilegeBounded(
    externalTable,
    declaredPrincipals,
    refuse,
    (row) => `table:${row.grantee_name}:${row.privilege_type}`,
  );
  assertPrivilegeBounded(
    externalColumn,
    declaredPrincipals,
    refuse,
    (row) => `column:${row.grantee_name}:${row.privilege_type}`,
  );
  return Object.freeze({
    tableAuthorityRows: externalTable.filter((row) =>
      WAIA_DATA_AUTHORITY_PRIVILEGES.includes(row.privilege_type),
    ),
    columnAuthorityRows: externalColumn.filter((row) =>
      WAIA_DATA_AUTHORITY_PRIVILEGES.includes(row.privilege_type),
    ),
  });
}

/**
 * Canonical `public` schema authority. CREATE is both digest-pinned and refused for every non-owner
 * principal, so the returned array is provably empty on a lawful target and any appearance of
 * schema CREATE fails closed twice. USAGE leaves the digest against a closed-principal assertion.
 */
export async function collectCanonicalSchemaAuthority(
  sql: Sql,
  options: Readonly<{ declaredPrincipals: readonly string[]; refuse: CatalogRefusal }>,
): Promise<readonly Readonly<{ grantee_name: string; privilege_type: string }>[]> {
  const { declaredPrincipals, refuse } = options;
  const rows = (await sql.unsafe(`
    SELECT CASE WHEN privilege.grantee=0 THEN 'PUBLIC'
        WHEN privilege.grantee=namespace.nspowner THEN 'SCHEMA_OWNER'
        WHEN grantee.rolname=current_user THEN 'CURRENT_USER'
        ELSE grantee.rolname END AS grantee_name,
      privilege.privilege_type,privilege.is_grantable
    FROM pg_namespace namespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespace.nspacl,acldefault('n',namespace.nspowner))
    ) privilege
    LEFT JOIN pg_roles grantee ON grantee.oid=privilege.grantee
    WHERE namespace.nspname='public'
    ORDER BY grantee_name,privilege.privilege_type
  `)) as unknown as readonly Readonly<{
    grantee_name: string;
    privilege_type: string;
    is_grantable: boolean;
  }>[];
  const admissible = new Set([
    "PUBLIC",
    ...AUTHORITY_TOKENS,
    ...PLATFORM_MANAGED_PRINCIPALS,
    ...WAIA_SCHEMA_USAGE_PRINCIPALS,
    ...declaredPrincipals,
  ]);
  const external = rows.filter((row) => !AUTHORITY_TOKENS.includes(row.grantee_name));
  for (const row of external) {
    if (!admissible.has(row.grantee_name)) {
      refuse("CATALOG_SCHEMA_UNKNOWN_PRINCIPAL", `${row.grantee_name}:${row.privilege_type}`);
    }
    if (!["CREATE", "USAGE"].includes(row.privilege_type)) {
      refuse("CATALOG_SCHEMA_UNKNOWN_PRIVILEGE", `${row.grantee_name}:${row.privilege_type}`);
    }
    if (row.privilege_type === "CREATE") {
      // Schema CREATE would let a principal shadow a WAIA function through `search_path` or add
      // relations the digest never covers. No migration grants it; nothing may hold it.
      refuse("CATALOG_SCHEMA_CREATE", row.grantee_name);
    }
    if (row.is_grantable) {
      refuse("CATALOG_SCHEMA_GRANTABLE", `${row.grantee_name}:${row.privilege_type}`);
    }
  }
  return external
    .filter((row) => row.privilege_type === "CREATE")
    .map((row) =>
      Object.freeze({ grantee_name: row.grantee_name, privilege_type: row.privilege_type }),
    );
}

export type MembershipRow = Readonly<{
  member_name: string;
  granted_role: string;
  grantor_name: string;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
  member_is_current_user: boolean;
}>;

/**
 * Splits role memberships into the migration authority's own management-only grants and everything
 * else.
 *
 * PostgreSQL 16+ auto-grants each newly created role back to a NOSUPERUSER CREATEROLE creator, and
 * records a platform-specific grantor (`supabase_admin` on the approved target). Because the
 * membership is `INHERIT FALSE, SET FALSE` it conveys no privilege at all: the authority cannot use
 * the role's grants without issuing a fresh GRANT, which would itself appear as a new membership
 * row. The authority already owns the covered relations and holds CREATEROLE, so ADMIN OPTION adds
 * nothing it cannot already do. Those rows therefore leave the digest — but only after this
 * function refuses any authority membership that is inheritable or settable.
 */
export function partitionCreatorMemberships(
  rows: readonly MembershipRow[],
  refuse: CatalogRefusal,
): readonly Omit<MembershipRow, "member_is_current_user">[] {
  const retained: Omit<MembershipRow, "member_is_current_user">[] = [];
  for (const row of rows) {
    if (!row.member_is_current_user) {
      // Retained verbatim in the pre-DEE-1020 digest shape: no field of a real membership is lost.
      retained.push(
        Object.freeze({
          member_name: row.member_name,
          granted_role: row.granted_role,
          grantor_name: row.grantor_name,
          admin_option: row.admin_option,
          inherit_option: row.inherit_option,
          set_option: row.set_option,
        }),
      );
      continue;
    }
    if (row.inherit_option || row.set_option) {
      // An inheritable or settable authority membership is real privilege, not creation metadata.
      refuse("CATALOG_AUTHORITY_CREATOR_MEMBERSHIP", `${row.member_name}:${row.granted_role}`);
    }
  }
  return retained;
}

/**
 * Refuses EXECUTE on a step's functions for every named role. PostgreSQL's stock PUBLIC EXECUTE is
 * admitted because it is present in both cluster classes — a Supabase-class function default ACL
 * leaves `proacl` NULL, so the stock default still applies — and because the covered functions are
 * either IMMUTABLE argument validators with no relation access or trigger functions the migration
 * explicitly revokes from PUBLIC and the named 0205 verifier independently asserts.
 */
export function assertRoutineExecuteBounded(
  rows: readonly Readonly<{ grantee_name: string; privilege_type: string }>[],
  refuse: CatalogRefusal,
): void {
  for (const row of rows) {
    if (row.grantee_name !== "PUBLIC" && !AUTHORITY_TOKENS.includes(row.grantee_name)) {
      refuse("CATALOG_ROUTINE_NAMED_GRANT", `${row.grantee_name}:${row.privilege_type}`);
    }
  }
}
