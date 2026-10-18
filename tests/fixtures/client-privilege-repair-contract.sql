-- DEE-1230 UNNUMBERED ISOLATED REHEARSAL CONTRACT. Not a production migration.
-- Caller supplies pg_temp.dee1230_input(manifest jsonb), exactly one row:
-- {database:'waia_client_privilege_fixture', names:[...], includeDefaults:true,
--  before:<dee1230_capture(names)>}. No production OIDs or target names live here.
-- Execute inside one root-owned transaction on the dedicated synthetic database.
-- The helper prelude is separated solely so a rehearsal can capture its synthetic
-- expected state before the atomic apply block. No helper persists after connection close.
CREATE OR REPLACE FUNCTION pg_temp.dee1230_acl(items aclitem[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  -- PostgreSQL rejects zero-dimensional empty arrays in aclexplode. Absent
  -- column ACLs mean no grants; nonempty arrays still receive native validation.
  IF items IS NULL OR cardinality(items)=0 THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]'::jsonb)
  FROM aclexplode(items) a);
END;
$$;
CREATE OR REPLACE FUNCTION pg_temp.dee1230_capture(names text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'tables',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'oid',c.oid::text,'schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
      'acl',pg_temp.dee1230_acl(coalesce(c.relacl,acldefault('r',c.relowner))),
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'kind',k.contype,
        'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb),
      'columns',coalesce((SELECT jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
        'acl',pg_temp.dee1230_acl(coalesce(a.attacl,'{}'::aclitem[]))) ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
      'policies',coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
        'permissive',p.polpermissive,'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),
        'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid=c.oid),'[]'::jsonb),
      'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
        'definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb)
      ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY(names)),'[]'::jsonb),
    'roles',(SELECT jsonb_agg(jsonb_build_object('oid',r.oid::text,'name',r.rolname,'super',r.rolsuper,'bypass',r.rolbypassrls,
      'inherit',r.rolinherit,'login',r.rolcanlogin,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,
      'replication',r.rolreplication,'limit',r.rolconnlimit) ORDER BY r.rolname) FROM pg_roles r),
    'memberships',coalesce((SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),
      'member',pg_get_userbyid(m.member),'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,
      'inherit',m.inherit_option,'set',m.set_option) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m),'[]'::jsonb),
    'defaults',coalesce((SELECT jsonb_agg(jsonb_build_object('creator',pg_get_userbyid(d.defaclrole),
      'schema',coalesce(n.nspname,'GLOBAL'),'type',d.defaclobjtype,'acl',pg_temp.dee1230_acl(d.defaclacl))
      ORDER BY d.defaclrole,d.defaclnamespace) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE d.defaclobjtype='r' AND (d.defaclnamespace=0 OR n.nspname='public')),'[]'::jsonb),
    'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
      'acl',pg_temp.dee1230_acl(coalesce(n.nspacl,acldefault('n',n.nspowner)))) FROM pg_namespace n WHERE n.nspname='public'),
    'eventTriggers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,
      'enabled',e.evtenabled,'tags',e.evttags,'owner',pg_get_userbyid(e.evtowner),
      'function',pg_get_functiondef(e.evtfoid)) ORDER BY e.evtname) FROM pg_event_trigger e),'[]'::jsonb)
  );
$$;
CREATE OR REPLACE FUNCTION pg_temp.dee1230_without_client_dxtm(acl jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
    FROM jsonb_array_elements(acl) WITH ORDINALITY e(value,ordinality)
    WHERE (e.value->>'grantee' IN ('anon','authenticated') AND
      e.value->>'privilege' IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')) IS NOT TRUE;
$$;
CREATE OR REPLACE FUNCTION pg_temp.dee1230_clean(before_state jsonb, include_defaults boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT jsonb_set(jsonb_set(before_state,'{tables}',
    (SELECT jsonb_agg(jsonb_set(t.value,'{acl}',pg_temp.dee1230_without_client_dxtm(t.value->'acl')) ORDER BY t.ordinality)
      FROM jsonb_array_elements(before_state->'tables') WITH ORDINALITY t(value,ordinality))),'{defaults}',
    (SELECT coalesce(jsonb_agg(CASE WHEN include_defaults AND d.value->>'creator'='postgres'
      AND d.value->>'schema'='public' AND d.value->>'type'='r'
      THEN jsonb_set(d.value,'{acl}',pg_temp.dee1230_without_client_dxtm(d.value->'acl')) ELSE d.value END
      ORDER BY d.ordinality),'[]'::jsonb)
      FROM jsonb_array_elements(before_state->'defaults') WITH ORDINALITY d(value,ordinality)));
$$;
REVOKE ALL ON FUNCTION pg_temp.dee1230_acl(aclitem[]),pg_temp.dee1230_capture(text[]),
  pg_temp.dee1230_without_client_dxtm(jsonb),pg_temp.dee1230_clean(jsonb,boolean) FROM PUBLIC;

-- DEE1230_APPLY_BOUNDARY
DO $$
DECLARE input jsonb; before_state jsonb; after_state jsonb; actual jsonb;
  names text[]; target text; item jsonb; grant_item jsonb; client text; include_defaults boolean;
BEGIN
  IF current_database()<>'waia_client_privilege_fixture' OR session_user<>'postgres' OR current_user<>session_user
    OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR current_setting('transaction_isolation')<>'read committed'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls) THEN
    RAISE EXCEPTION 'DEE1230_ISOLATED_PG17_OWNER_CONTEXT_REQUIRED';
  END IF;
  PERFORM set_config('lock_timeout','1000ms',true);
  PERFORM set_config('statement_timeout','5000ms',true);
  PERFORM set_config('transaction_timeout','10000ms',true);
  IF (SELECT count(*) FROM pg_temp.dee1230_input)<>1 THEN RAISE EXCEPTION 'DEE1230_ONE_MANIFEST_REQUIRED'; END IF;
  SELECT manifest INTO input FROM pg_temp.dee1230_input;
  IF input->>'database' IS DISTINCT FROM current_database() OR jsonb_typeof(input->'names') IS DISTINCT FROM 'array'
    OR jsonb_typeof(input->'includeDefaults') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(input->'before') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DEE1230_INVALID_MANIFEST'; END IF;
  SELECT array_agg(value ORDER BY value) INTO names FROM jsonb_array_elements_text(input->'names');
  include_defaults := (input->>'includeDefaults')::boolean;
  before_state := input->'before';
  IF cardinality(names) NOT BETWEEN 1 AND 200 OR cardinality(names)<>(SELECT count(DISTINCT x) FROM unnest(names) x)
    OR EXISTS (SELECT 1 FROM unnest(names) x WHERE (x !~ '^trader_[a-z0-9_]+$' AND x<>'exchange_credentials')
      OR x='trader_org_profiles') OR jsonb_array_length(before_state->'tables')<>cardinality(names) THEN
    RAISE EXCEPTION 'DEE1230_TARGET_SCOPE_REFUSED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication))
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated'))<>2
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname IN ('anon','authenticated')) THEN RAISE EXCEPTION 'DEE1230_CLIENT_ROLE_DRIFT'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(before_state->'tables') LOOP
    IF item->>'owner'<>'postgres' OR item->>'kind'<>'r' OR item->>'schema'<>'public'
      OR NOT (item->>'name'=ANY(names)) THEN RAISE EXCEPTION 'DEE1230_TARGET_IDENTITY_DRIFT'; END IF;
    FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client)<>4
        OR (SELECT count(DISTINCT a->>'privilege') FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client)<>4
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client AND
          (a->>'grantor' IS DISTINCT FROM 'postgres' OR a->'grantable' IS DISTINCT FROM 'false'::jsonb OR
            a->>'privilege' NOT IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))) THEN
        RAISE EXCEPTION 'DEE1230_EXPECTED_CLIENT_DELTA_INVALID';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'='PUBLIC')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'columns') col,
        LATERAL jsonb_array_elements(col->'acl') a WHERE a->>'grantee' IN ('anon','authenticated','PUBLIC')) THEN
      RAISE EXCEPTION 'DEE1230_ALTERNATE_CLIENT_PRIVILEGE_PATH';
    END IF;
  END LOOP;
  IF include_defaults THEN
    IF (SELECT count(*) FROM jsonb_array_elements(before_state->'defaults') d
      WHERE d->>'creator'='postgres' AND d->>'schema'='public')<>1
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(before_state->'defaults') d
        WHERE d->>'creator'='postgres' AND d->>'schema'='GLOBAL') THEN
      RAISE EXCEPTION 'DEE1230_DEFAULT_SCOPE_DRIFT';
    END IF;
    SELECT value INTO item FROM jsonb_array_elements(before_state->'defaults') WHERE value->>'creator'='postgres' AND value->>'schema'='public';
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'='PUBLIC') THEN
      RAISE EXCEPTION 'DEE1230_DEFAULT_PUBLIC_PRIVILEGE_PATH';
    END IF;
    FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client)<>4
        OR (SELECT count(DISTINCT a->>'privilege') FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client)<>4
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'acl') a WHERE a->>'grantee'=client
          AND (a->>'grantor' IS DISTINCT FROM 'postgres' OR a->'grantable' IS DISTINCT FROM 'false'::jsonb OR
            a->>'privilege' NOT IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))) THEN
        RAISE EXCEPTION 'DEE1230_DEFAULT_DELTA_INVALID';
      END IF;
    END LOOP;
  END IF;
  -- Stable order and bounded lock wait. No backend termination or forced retry.
  FOREACH target IN ARRAY names LOOP EXECUTE format('LOCK TABLE public.%I IN ACCESS SHARE MODE',target); END LOOP;
  actual := pg_temp.dee1230_capture(names);
  after_state := pg_temp.dee1230_clean(before_state,include_defaults);
  IF actual=after_state THEN RETURN; END IF;
  IF actual<>before_state THEN RAISE EXCEPTION 'DEE1230_UNKNOWN_OR_MIXED_CATALOG_DRIFT'; END IF;
  FOREACH target IN ARRAY names LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM anon, authenticated RESTRICT',target);
  END LOOP;
  IF include_defaults THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated RESTRICT;
  END IF;
  IF pg_temp.dee1230_capture(names)<>after_state THEN RAISE EXCEPTION 'DEE1230_POSTCONDITION_DRIFT'; END IF;
  FOREACH target IN ARRAY names LOOP
    FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(client,format('public.%I',target),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(client,format('public.%I',target),'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'DEE1230_EFFECTIVE_CLIENT_RIGHTS_REMAIN';
      END IF;
    END LOOP;
  END LOOP;
END $$;
