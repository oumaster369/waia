-- Dedicated disposable fixture ONLY. Not a migration, production schema or apply path.
CREATE SCHEMA twin_model_fixture;
CREATE TABLE twin_model_fixture.scope_lock (
  organization_id text NOT NULL, subject_id text NOT NULL,
  PRIMARY KEY (organization_id, subject_id)
);
CREATE TABLE twin_model_fixture.consent (
  organization_id text NOT NULL, subject_id text NOT NULL,
  id text NOT NULL, version integer NOT NULL CHECK (version > 0), payload jsonb NOT NULL,
  PRIMARY KEY (organization_id, subject_id, id, version),
  FOREIGN KEY (organization_id, subject_id) REFERENCES twin_model_fixture.scope_lock
);
CREATE TABLE twin_model_fixture.object (
  organization_id text NOT NULL, subject_id text NOT NULL, purpose text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('observation','claim','correction','hypothesis','experience','private_source')),
  id text NOT NULL, version integer NOT NULL CHECK (version > 0),
  recorded_at timestamptz NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (organization_id, subject_id, kind, id, version),
  FOREIGN KEY (organization_id, subject_id) REFERENCES twin_model_fixture.scope_lock
);
CREATE INDEX twin_fixture_object_purpose ON twin_model_fixture.object(organization_id, subject_id, purpose, recorded_at);
CREATE TABLE twin_model_fixture.link (
  organization_id text NOT NULL, subject_id text NOT NULL,
  source_kind text NOT NULL, source_id text NOT NULL, source_version integer NOT NULL,
  target_kind text NOT NULL, target_id text NOT NULL, target_version integer NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('supports','contradicts','contextualizes')),
  PRIMARY KEY (organization_id, subject_id, source_kind, source_id, source_version, target_kind, target_id, target_version, relationship),
  FOREIGN KEY (organization_id, subject_id, source_kind, source_id, source_version)
    REFERENCES twin_model_fixture.object(organization_id, subject_id, kind, id, version) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, subject_id, target_kind, target_id, target_version)
    REFERENCES twin_model_fixture.object(organization_id, subject_id, kind, id, version) ON DELETE CASCADE
);
CREATE INDEX twin_fixture_link_target ON twin_model_fixture.link(organization_id, subject_id, target_kind, target_id, target_version);
CREATE TABLE twin_model_fixture.receipt (
  organization_id text NOT NULL, subject_id text NOT NULL, purpose text NOT NULL,
  request_id text NOT NULL, fingerprint text NOT NULL,
  target_kind text NOT NULL, target_id text NOT NULL, target_version integer NOT NULL,
  PRIMARY KEY (organization_id, subject_id, purpose, request_id),
  FOREIGN KEY (organization_id, subject_id, target_kind, target_id, target_version)
    REFERENCES twin_model_fixture.object(organization_id, subject_id, kind, id, version) ON DELETE CASCADE
);
CREATE TABLE twin_model_fixture.rights_request (
  organization_id text NOT NULL, subject_id text NOT NULL, purpose text NOT NULL,
  request_id text NOT NULL, source_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('withdraw_modelling','delete_source')),
  requested_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('restricted','live_removed')),
  source_kind text NOT NULL CHECK (source_kind IN ('observation','private_source','experience')),
  PRIMARY KEY (organization_id, subject_id, purpose, request_id),
  FOREIGN KEY (organization_id, subject_id) REFERENCES twin_model_fixture.scope_lock
);
CREATE INDEX twin_fixture_rights_source ON twin_model_fixture.rights_request(organization_id, subject_id, source_kind, source_id);
-- Trusted synthetic seed authority only; the repository has no INSERT/UPDATE grant.
CREATE TABLE twin_model_fixture.archive_authority (
  organization_id text NOT NULL, subject_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('private_source','experience')),
  id text NOT NULL, version integer NOT NULL CHECK (version > 0), payload jsonb NOT NULL,
  PRIMARY KEY (organization_id,subject_id,kind,id,version),
  FOREIGN KEY (organization_id,subject_id) REFERENCES twin_model_fixture.scope_lock
);
-- Every fixture consent writer, including a NEW version, joins the repository lock.
-- Same-transaction reads alone under READ COMMITTED do not prevent a revoke race.
CREATE FUNCTION twin_model_fixture.lock_consent_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.organization_id,OLD.subject_id,OLD.id,OLD.version,to_jsonb(OLD)->>'kind')
    IS DISTINCT FROM (NEW.organization_id,NEW.subject_id,NEW.id,NEW.version,to_jsonb(NEW)->>'kind') THEN
    RAISE EXCEPTION 'Consent identity is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(OLD.organization_id,OLD.subject_id)::text,0));
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(NEW.organization_id,NEW.subject_id)::text,0));
  RETURN NEW;
END $$;
CREATE TRIGGER twin_fixture_consent_scope_lock BEFORE INSERT OR UPDATE OR DELETE
  ON twin_model_fixture.consent FOR EACH ROW EXECUTE FUNCTION twin_model_fixture.lock_consent_scope();
CREATE TRIGGER twin_fixture_archive_scope_lock BEFORE INSERT OR UPDATE OR DELETE
  ON twin_model_fixture.archive_authority FOR EACH ROW EXECUTE FUNCTION twin_model_fixture.lock_consent_scope();
-- App-scoped access remains primary (ADR-0007); fixture service is not superuser/owner.
CREATE ROLE twin_fixture_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE twin_fixture_browser NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA twin_model_fixture TO twin_fixture_service, twin_fixture_browser;
GRANT SELECT, INSERT ON twin_model_fixture.scope_lock TO twin_fixture_service;
GRANT SELECT ON twin_model_fixture.consent, twin_model_fixture.archive_authority TO twin_fixture_service;
GRANT SELECT, INSERT, DELETE ON twin_model_fixture.object, twin_model_fixture.link, twin_model_fixture.receipt TO twin_fixture_service;
GRANT SELECT, INSERT, UPDATE ON twin_model_fixture.rights_request TO twin_fixture_service;
-- Browser role deliberately receives no table privileges. No platform roles are modified.
