import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import {
  RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1,
  RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1,
} from "./research-development-source-contract-v1";

/** Verify the authenticated session, not merely the ability of an owner URI to
 * SET ROLE. The owner uses this inside its driver-pinned root transaction before any payload. */
export async function requireResearchDevelopmentSourceLoginV1(sql: postgres.TransactionSql): Promise<void> {
  const handle = sql as unknown as Record<string, unknown>;
  if (typeof handle.savepoint !== "function" || typeof handle.reserve === "function" ||
      typeof handle.begin === "function" || typeof handle.release === "function" || typeof handle.end === "function") {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_TRANSACTION_SESSION_REQUIRED");
  }
  const rows = await sql<Readonly<{
    session_user: string; current_user: string;
    login_valid: boolean; role_valid: boolean; owns_database: boolean;
    direct_grants_or_ownership: boolean; memberships: string[];
    role_memberships: number; writer_acl_valid: boolean;
  }>[]>`
    SELECT session_user::text AS session_user, current_user::text AS current_user,
      (login.rolcanlogin AND NOT login.rolinherit AND NOT login.rolsuper
        AND NOT login.rolcreatedb AND NOT login.rolcreaterole
        AND NOT login.rolreplication AND NOT login.rolbypassrls
        AND login.rolconnlimit=2) AS login_valid,
      (NOT writer.rolcanlogin AND NOT writer.rolinherit AND NOT writer.rolsuper AND NOT writer.rolcreatedb
        AND NOT writer.rolcreaterole AND NOT writer.rolreplication
        AND NOT writer.rolbypassrls) AS role_valid,
      database.datdba IN (login.oid,writer.oid) AS owns_database,
      EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass
        AND d.refobjid=login.oid AND d.deptype IN ('a','o')) AS direct_grants_or_ownership,
      COALESCE((SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
        FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
        WHERE m.member=login.oid),ARRAY[]::text[]) AS memberships,
      (SELECT count(*)::integer FROM pg_auth_members m WHERE m.member=writer.oid) AS role_memberships,
      (NOT EXISTS (SELECT 1 FROM pg_shdepend d
        WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=writer.oid
        AND (d.deptype='o' OR (d.deptype='a' AND NOT (
          d.dbid=database.oid AND (
            (d.classid='pg_namespace'::regclass AND d.objid='public'::regnamespace)
            OR (d.classid='pg_class'::regclass AND d.objid IN (
              'public.trader_research_development_source_runs_v1'::regclass,
              'public.trader_historical_dataset_authority_v2'::regclass)))))))
        AND has_schema_privilege(writer.oid,'public','USAGE')
        AND NOT has_schema_privilege(writer.oid,'public','CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
          WHERE n.oid='public'::regnamespace AND a.grantee=writer.oid
            AND (a.privilege_type<>'USAGE' OR a.is_grantable))
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login.oid
          AND (m.admin_option OR m.inherit_option OR NOT m.set_option))
        AND NOT has_database_privilege(login.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(writer.oid,current_database(),'CREATE')
        AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity) FROM pg_class c
          WHERE c.oid IN ('public.trader_research_development_source_runs_v1'::regclass,
            'public.trader_historical_dataset_authority_v2'::regclass))
        AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.prosecdef AND p.prorettype<>'trigger'::regtype
            AND has_function_privilege(writer.oid,p.oid,'EXECUTE'))
        AND NOT EXISTS (SELECT 1 FROM pg_class c
          CROSS JOIN LATERAL aclexplode(c.relacl) a
          WHERE c.oid IN ('public.trader_research_development_source_runs_v1'::regclass,
            'public.trader_historical_dataset_authority_v2'::regclass)
          AND a.grantee=writer.oid
          AND (a.privilege_type NOT IN ('SELECT','INSERT') OR a.is_grantable))
        AND has_table_privilege(writer.oid,'public.trader_research_development_source_runs_v1','SELECT')
        AND has_table_privilege(writer.oid,'public.trader_research_development_source_runs_v1','INSERT')
        AND NOT has_table_privilege(writer.oid,'public.trader_research_development_source_runs_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND has_table_privilege(writer.oid,'public.trader_historical_dataset_authority_v2','SELECT')
        AND has_table_privilege(writer.oid,'public.trader_historical_dataset_authority_v2','INSERT')
        AND NOT has_table_privilege(writer.oid,'public.trader_historical_dataset_authority_v2','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
        AS writer_acl_valid
    FROM pg_roles login
    JOIN pg_roles writer ON writer.rolname=${RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1}
    JOIN pg_database database ON database.datname=current_database()
    WHERE login.rolname=session_user
  `;
  const row = rows[0];
  if (rows.length !== 1 || row?.session_user !== RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1 ||
      row.current_user !== RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1 || !row.login_valid || !row.role_valid ||
      row.owns_database || !row.writer_acl_valid || row.direct_grants_or_ownership || row.role_memberships !== 0 ||
      row.memberships.length !== 1 || row.memberships[0] !== RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_WRITER_LOGIN_REFUSED");
  }
}

