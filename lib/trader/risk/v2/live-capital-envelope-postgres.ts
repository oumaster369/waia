import type postgres from "postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  LIVE_CAPITAL_ENVELOPE_JOURNAL_V2,
  LIVE_CAPITAL_ENVELOPE_STAGES_V2,
  LIVE_CAPITAL_ENVELOPE_V2,
  assertLiveCapitalEnvelopeReceiptV2,
  decideLiveCapitalEnvelopePublicationV2,
  decideLiveCapitalEnvelopeWindowV2,
  liveCapitalBasisBindingV2,
  liveCapitalEnvelopeCommandSchemaV2,
  readStoredSourceMethodQualifiedV2,
  sealLiveCapitalEnvelopeV2,
  type LiveCapitalEnvelopeCommandV2,
  type LiveCapitalEnvelopeStageV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import {
  RiskCurrentAccountRefusedV1,
  sealRiskAccountRecordV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

type Sql = postgres.Sql | postgres.TransactionSql;
type Stage = LiveCapitalEnvelopeStageV2 | "INVALIDATED";
type JournalRow = {
  stage: Stage;
  envelope_digest: string | null;
  basis_digest: string | null;
  reason: string | null;
};
type CurrentRow = {
  command_id: string;
  envelope_digest: string;
  policy_digest: string;
  release_sha: string;
  basis_digest: string | null;
};

export type LiveCapitalObservedIdentityV2 = Readonly<{
  organizationId: string;
  accountId: string;
  policyDigest: string;
  releaseSha: string;
}>;

export type LiveCapitalEnvelopeResultV2 = Readonly<{
  decision: "PUBLISHED" | "REFUSED";
  reason: string | null;
  envelopeDigest: string | null;
  basisDigest: string | null;
  allowanceId: null;
  orderId: null;
  venueEffects: "ZERO";
  invalidated: boolean;
  replayed: boolean;
}>;

function refused(reason: string, invalidated = false): LiveCapitalEnvelopeResultV2 {
  return {
    decision: "REFUSED",
    reason,
    envelopeDigest: null,
    basisDigest: null,
    allowanceId: null,
    orderId: null,
    venueEffects: "ZERO",
    invalidated,
    replayed: false,
  };
}

function published(
  envelopeDigest: string,
  basisDigest: string,
  replayed: boolean,
): LiveCapitalEnvelopeResultV2 {
  return {
    decision: "PUBLISHED",
    reason: null,
    envelopeDigest,
    basisDigest,
    allowanceId: null,
    orderId: null,
    venueEffects: "ZERO",
    invalidated: false,
    replayed,
  };
}

function commandFromBody(textBody: string): LiveCapitalEnvelopeCommandV2 {
  const parsed = JSON.parse(textBody) as { schemaVersion?: string };
  const { schemaVersion, ...rest } = parsed;
  if (schemaVersion !== LIVE_CAPITAL_ENVELOPE_V2)
    throw new RiskCurrentAccountRefusedV1("RECORD_SEAL");
  return liveCapitalEnvelopeCommandSchemaV2.parse(rest);
}

function bodyText<T extends { contentDigest: string }>(sealed: T): string {
  const { contentDigest: _digest, ...body } = sealed;
  void _digest;
  return canonicalJsonString(body);
}

async function dbNow(tx: Sql): Promise<string> {
  const [row] = await tx<{ now: string }[]>`
    select to_char(date_trunc('milliseconds', clock_timestamp()) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`;
  return row!.now;
}

async function journalInvalidatedOnce(
  tx: Sql,
  command: LiveCapitalEnvelopeCommandV2,
  rows: readonly JournalRow[],
  fields: {
    envelopeDigest: string | null;
    basisDigest: string | null;
    reason: string;
  },
): Promise<void> {
  if (rows.some((row) => row.stage === "INVALIDATED")) return;
  await journal(tx, command, "INVALIDATED", fields);
}

async function journal(
  tx: Sql,
  command: LiveCapitalEnvelopeCommandV2,
  stage: Stage,
  fields: {
    envelopeDigest: string | null;
    basisDigest: string | null;
    reason: string | null;
    sourceMethodQualified?: boolean;
  },
): Promise<void> {
  const qualified = fields.sourceMethodQualified === true;
  const sealed = sealRiskAccountRecordV1({
    schemaVersion: LIVE_CAPITAL_ENVELOPE_JOURNAL_V2,
    organizationId: command.organizationId,
    accountId: command.accountId,
    commandId: command.commandId,
    stage,
    envelopeDigest: fields.envelopeDigest,
    basisDigest: fields.basisDigest,
    reason: fields.reason,
    ...(qualified ? { sourceMethodQualified: qualified } : {}),
  });
  const text = bodyText(sealed);
  await tx`
    insert into trader_live_capital_envelope_journal_v2 (
      organization_id, account_id, content_digest, body_text, command_id, stage,
      envelope_digest, basis_digest, reason)
    values (
      ${command.organizationId}::uuid, ${command.accountId}, ${sealed.contentDigest}, ${text},
      ${command.commandId}::uuid, ${stage}, ${fields.envelopeDigest}, ${fields.basisDigest}, ${fields.reason})`;
}

async function loadJournal(tx: Sql, command: LiveCapitalEnvelopeCommandV2): Promise<JournalRow[]> {
  return tx<JournalRow[]>`
    select stage, envelope_digest, basis_digest, reason
    from trader_live_capital_envelope_journal_v2
    where organization_id = ${command.organizationId}::uuid
      and account_id = ${command.accountId}
      and command_id = ${command.commandId}::uuid
    order by created_at`;
}

async function loadCurrent(
  tx: Sql,
  organizationId: string,
  accountId: string,
): Promise<CurrentRow | null> {
  const rows = await tx<CurrentRow[]>`
    select command_id, envelope_digest, policy_digest, release_sha, basis_digest
    from trader_live_capital_envelope_current_v2
    where organization_id = ${organizationId}::uuid and account_id = ${accountId}
    for update`;
  return rows[0] ?? null;
}

async function lockScope(tx: Sql, organizationId: string, accountId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(1145, hashtext(${`${organizationId}:${accountId}`}))`;
}

function requireCommand(
  command: LiveCapitalEnvelopeCommandV2,
  boundOrganizationId: string,
): LiveCapitalEnvelopeCommandV2 {
  if (command.organizationId !== boundOrganizationId)
    throw new RiskCurrentAccountRefusedV1("EXTERNAL_ORGANIZATION");
  return command;
}

function requireObservedOrganization(
  observed: LiveCapitalObservedIdentityV2,
  boundOrganizationId: string,
): void {
  if (observed.organizationId !== boundOrganizationId)
    throw new RiskCurrentAccountRefusedV1("EXTERNAL_ORGANIZATION");
}

function windowRefusalReason(decision: {
  decision: "PUBLISHED" | "REFUSED";
  reason?: string;
}): string {
  if (decision.decision === "PUBLISHED") return "LIVE_CAPITAL_IDENTITY_CHANGED";
  if (
    decision.reason === "SOURCE_METHOD_UNQUALIFIED" ||
    decision.reason === "LIVE_CAPITAL_ENVELOPE_STALE" ||
    decision.reason === "LIVE_CAPITAL_ENVELOPE_ABSENT" ||
    decision.reason === "LIVE_CAPITAL_IDENTITY_CHANGED" ||
    decision.reason === "EXTERNAL_ORGANIZATION"
  ) {
    return decision.reason;
  }
  return "LIVE_CAPITAL_IDENTITY_CHANGED";
}

async function publishedSourceMethodQualified(
  tx: Sql,
  pointer: { organizationId: string; accountId: string },
  envelopeDigest: string,
): Promise<boolean> {
  const rows = await tx<{ body_text: string }[]>`
    select body_text from trader_live_capital_envelope_journal_v2
    where organization_id = ${pointer.organizationId}::uuid
      and account_id = ${pointer.accountId}
      and stage = 'PUBLISHED'
      and envelope_digest = ${envelopeDigest}
    limit 1`;
  return readStoredSourceMethodQualifiedV2(rows[0]?.body_text);
}

/** A stored PUBLISHED row is not authority by itself. Re-decide from the sealed body,
 * the database clock, the stored source-method flag, and the caller's observed identity. */
async function recheckPublishedAuthorityV2(
  tx: Sql,
  observed: LiveCapitalObservedIdentityV2,
  pointer: { organizationId: string; accountId: string },
  envelopeDigest: string,
  basisDigest: string,
): Promise<LiveCapitalEnvelopeResultV2> {
  const [envelope] = await tx<{ body_text: string }[]>`
    select body_text from trader_live_capital_envelopes_v2
    where organization_id = ${pointer.organizationId}::uuid
      and account_id = ${pointer.accountId}
      and content_digest = ${envelopeDigest}`;
  if (!envelope) {
    await tx`delete from trader_live_capital_envelope_current_v2
      where organization_id = ${pointer.organizationId}::uuid and account_id = ${pointer.accountId}`;
    return refused("LIVE_CAPITAL_ENVELOPE_ABSENT", true);
  }
  const stored = commandFromBody(envelope.body_text);
  const receipt = sealLiveCapitalEnvelopeV2(stored);
  if (receipt.contentDigest !== envelopeDigest)
    throw new RiskCurrentAccountRefusedV1("RECORD_SEAL");
  const nowUtc = await dbNow(tx);
  const decision = decideLiveCapitalEnvelopeWindowV2({
    liveCapitalEnvelope: receipt,
    bound: { ...observed, nowUtc },
    sourceMethodQualified: await publishedSourceMethodQualified(tx, pointer, envelopeDigest),
  });
  if (decision.decision === "PUBLISHED" && decision.basisDigest === basisDigest)
    return published(envelopeDigest, basisDigest, true);
  if (decision.decision === "REFUSED" && decision.reason === "EXTERNAL_ORGANIZATION")
    throw new RiskCurrentAccountRefusedV1("EXTERNAL_ORGANIZATION");
  const reason = windowRefusalReason(decision);
  const rows = await loadJournal(tx, stored);
  if (!rows.some((row) => row.stage === "INVALIDATED")) {
    await journal(tx, stored, "INVALIDATED", {
      envelopeDigest,
      basisDigest,
      reason,
    });
  }
  await tx`delete from trader_live_capital_envelope_current_v2
    where organization_id = ${pointer.organizationId}::uuid and account_id = ${pointer.accountId}`;
  return { ...refused(reason, true), envelopeDigest, basisDigest };
}

/** One durable stage. A repeated call returns the committed stage and does not insert another row. */
export async function advanceLiveCapitalEnvelopeStageV2(
  sql: postgres.Sql,
  input: {
    command: LiveCapitalEnvelopeCommandV2;
    boundOrganizationId: string;
    stage: LiveCapitalEnvelopeStageV2;
    observed: LiveCapitalObservedIdentityV2;
    /** Explicit human qualification. Omitted and false both fail closed. */
    sourceMethodQualified?: boolean;
  },
): Promise<LiveCapitalEnvelopeResultV2> {
  requireObservedOrganization(input.observed, input.boundOrganizationId);
  const command = requireCommand(input.command, input.boundOrganizationId);
  const receipt = sealLiveCapitalEnvelopeV2(command);
  assertLiveCapitalEnvelopeReceiptV2(receipt);
  const stage = input.stage;
  const prior = LIVE_CAPITAL_ENVELOPE_STAGES_V2[LIVE_CAPITAL_ENVELOPE_STAGES_V2.indexOf(stage) - 1];
  return sql.begin(async (tx) => {
    await lockScope(tx, command.organizationId, command.accountId);
    const rows = await loadJournal(tx, command);
    const invalidated = rows.find((row) => row.stage === "INVALIDATED");
    const publishedRow = rows.find((row) => row.stage === "PUBLISHED");
    // A published command that was later invalidated stays closed. An invalidated
    // command that never published is decided again; a second INVALIDATED row is not inserted.
    if (invalidated && publishedRow) {
      return refused(invalidated.reason ?? "LIVE_CAPITAL_ENVELOPE_STALE", true);
    }
    const existing = rows.find((row) => row.stage === stage);
    if (existing?.stage === "PUBLISHED" && existing.envelope_digest && existing.basis_digest) {
      return recheckPublishedAuthorityV2(
        tx,
        input.observed,
        { organizationId: command.organizationId, accountId: command.accountId },
        existing.envelope_digest,
        existing.basis_digest,
      );
    }
    if (existing) {
      return {
        decision: "REFUSED",
        reason: "STAGE_ALREADY_COMMITTED",
        envelopeDigest: existing.envelope_digest,
        basisDigest: existing.basis_digest,
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
        invalidated: false,
        replayed: true,
      };
    }
    if (
      rows.some(
        (row) =>
          LIVE_CAPITAL_ENVELOPE_STAGES_V2.indexOf(row.stage as LiveCapitalEnvelopeStageV2) >
          LIVE_CAPITAL_ENVELOPE_STAGES_V2.indexOf(stage),
      )
    ) {
      const publishedRow = rows.find((row) => row.stage === "PUBLISHED");
      if (publishedRow?.envelope_digest && publishedRow.basis_digest) {
        return recheckPublishedAuthorityV2(
          tx,
          input.observed,
          { organizationId: command.organizationId, accountId: command.accountId },
          publishedRow.envelope_digest,
          publishedRow.basis_digest,
        );
      }
      return refused("STAGE_ALREADY_COMMITTED");
    }
    if (prior && !rows.some((row) => row.stage === prior))
      throw new RiskCurrentAccountRefusedV1("STAGE_ORDER");
    if (stage === "CAPTURED") {
      await journal(tx, command, "CAPTURED", {
        envelopeDigest: null,
        basisDigest: null,
        reason: null,
      });
      return refused("CAPTURED");
    }
    if (stage === "SEALED") {
      const text = bodyText(receipt);
      await tx`
        insert into trader_live_capital_envelopes_v2 (
          organization_id, account_id, content_digest, body_text, command_id, policy_digest, release_sha,
          capital_notional, loss_limit_notional, valid_from, valid_until)
        values (
          ${command.organizationId}::uuid, ${command.accountId}, ${receipt.contentDigest}, ${text},
          ${command.commandId}::uuid, ${command.policyDigest}, ${command.releaseSha},
          ${command.capitalNotional}, ${command.lossLimitNotional},
          ${command.validFromUtc}::timestamptz, ${command.validUntilUtc}::timestamptz)`;
      await journal(tx, command, "SEALED", {
        envelopeDigest: receipt.contentDigest,
        basisDigest: null,
        reason: null,
      });
      return refused("SEALED");
    }
    const nowUtc = await dbNow(tx);
    const decision = decideLiveCapitalEnvelopePublicationV2({
      liveCapitalEnvelope: receipt,
      sourceMethodQualified: input.sourceMethodQualified === true,
      bound: { ...input.observed, nowUtc },
    });
    let current = await loadCurrent(tx, command.organizationId, command.accountId);
    if (decision.decision !== "PUBLISHED") {
      if (invalidated) return refused(invalidated.reason ?? decision.reason, true);
      if (current?.command_id === command.commandId) {
        await journalInvalidatedOnce(tx, command, rows, {
          envelopeDigest: current.envelope_digest,
          basisDigest: current.basis_digest,
          reason: decision.reason,
        });
        await tx`delete from trader_live_capital_envelope_current_v2
          where organization_id = ${command.organizationId}::uuid and account_id = ${command.accountId}`;
        return {
          ...refused(decision.reason, true),
          envelopeDigest: current.envelope_digest,
          basisDigest: current.basis_digest,
        };
      }
      await journalInvalidatedOnce(tx, command, rows, {
        envelopeDigest: receipt.contentDigest,
        basisDigest: null,
        reason: decision.reason,
      });
      return refused(decision.reason, true);
    }
    if (!current && rows.some((row) => row.stage === "ADMITTED")) {
      await tx`
        insert into trader_live_capital_envelope_current_v2 (
          organization_id, account_id, command_id, envelope_digest, policy_digest, release_sha,
          basis_digest, revision, updated_at)
        values (
          ${command.organizationId}::uuid, ${command.accountId}, ${command.commandId}::uuid,
          ${receipt.contentDigest}, ${command.policyDigest}, ${command.releaseSha},
          null, 1, ${nowUtc}::timestamptz)`;
      current = {
        command_id: command.commandId,
        envelope_digest: receipt.contentDigest,
        policy_digest: command.policyDigest,
        release_sha: command.releaseSha,
        basis_digest: null,
      };
    }
    if (current && current.command_id !== command.commandId) {
      await journalInvalidatedOnce(tx, command, rows, {
        envelopeDigest: receipt.contentDigest,
        basisDigest: null,
        reason: "OVERLAPPING_AUTHORITY",
      });
      return refused("OVERLAPPING_AUTHORITY");
    }
    if (stage === "ADMITTED") {
      if (!current) {
        await tx`
          insert into trader_live_capital_envelope_current_v2 (
            organization_id, account_id, command_id, envelope_digest, policy_digest, release_sha,
            basis_digest, revision, updated_at)
          values (
            ${command.organizationId}::uuid, ${command.accountId}, ${command.commandId}::uuid,
            ${receipt.contentDigest}, ${command.policyDigest}, ${command.releaseSha},
            null, 1, ${nowUtc}::timestamptz)`;
      }
      await journal(tx, command, "ADMITTED", {
        envelopeDigest: receipt.contentDigest,
        basisDigest: null,
        reason: null,
      });
      return refused("ADMITTED");
    }
    if (
      !current ||
      current.command_id !== command.commandId ||
      current.envelope_digest !== receipt.contentDigest
    ) {
      await journalInvalidatedOnce(tx, command, rows, {
        envelopeDigest: receipt.contentDigest,
        basisDigest: null,
        reason: "OVERLAPPING_AUTHORITY",
      });
      return refused("OVERLAPPING_AUTHORITY");
    }
    const basis = liveCapitalBasisBindingV2(receipt);
    const basisText = bodyText(basis);
    if (decision.basisDigest !== basis.contentDigest)
      throw new RiskCurrentAccountRefusedV1("BASIS_DIGEST");
    await tx`
      insert into trader_live_capital_basis_bindings_v2 (
        organization_id, account_id, content_digest, body_text, envelope_digest, policy_digest, release_sha)
      values (
        ${command.organizationId}::uuid, ${command.accountId}, ${basis.contentDigest}, ${basisText},
        ${receipt.contentDigest}, ${command.policyDigest}, ${command.releaseSha})`;
    await tx`
      update trader_live_capital_envelope_current_v2
      set basis_digest = ${basis.contentDigest}, revision = revision + 1, updated_at = ${nowUtc}::timestamptz
      where organization_id = ${command.organizationId}::uuid and account_id = ${command.accountId}
        and command_id = ${command.commandId}::uuid and basis_digest is null`;
    await journal(tx, command, "PUBLISHED", {
      envelopeDigest: receipt.contentDigest,
      basisDigest: basis.contentDigest,
      reason: null,
      sourceMethodQualified: input.sourceMethodQualified === true,
    });
    return published(receipt.contentDigest, basis.contentDigest, false);
  });
}

/** Runs every durable stage. Restart continues from the last committed stage without a second effect. */
export async function produceLiveCapitalEnvelopeV2(
  sql: postgres.Sql,
  input: {
    command: LiveCapitalEnvelopeCommandV2;
    boundOrganizationId: string;
    observed: LiveCapitalObservedIdentityV2;
    /** Explicit human qualification. Omitted and false both fail closed. */
    sourceMethodQualified?: boolean;
  },
): Promise<LiveCapitalEnvelopeResultV2> {
  let last = refused("CAPTURED");
  for (const stage of LIVE_CAPITAL_ENVELOPE_STAGES_V2) {
    last = await advanceLiveCapitalEnvelopeStageV2(sql, { ...input, stage });
    if (
      last.decision === "REFUSED" &&
      !last.replayed &&
      last.reason !== "CAPTURED" &&
      last.reason !== "SEALED" &&
      last.reason !== "ADMITTED"
    ) {
      return last;
    }
  }
  return last;
}

/** Missing, stale, or changed account/policy/release clears the current envelope and its basis. */
export async function invalidateLiveCapitalEnvelopeV2(
  sql: postgres.Sql,
  input: {
    boundOrganizationId: string;
    /** Account that holds the current pointer. Observed account may differ. */
    accountId: string;
    observed: {
      organizationId: string;
      accountId: string;
      policyDigest: string;
      releaseSha: string;
    };
  },
): Promise<LiveCapitalEnvelopeResultV2> {
  if (input.observed.organizationId !== input.boundOrganizationId) {
    throw new RiskCurrentAccountRefusedV1("EXTERNAL_ORGANIZATION");
  }
  const pointerAccountId = input.accountId;
  return sql.begin(async (tx) => {
    await lockScope(tx, input.boundOrganizationId, pointerAccountId);
    const current = await loadCurrent(tx, input.boundOrganizationId, pointerAccountId);
    if (!current) return refused("LIVE_CAPITAL_ENVELOPE_ABSENT");
    const [envelope] = await tx<{ body_text: string; command_id: string }[]>`
      select body_text, command_id from trader_live_capital_envelopes_v2
      where organization_id = ${input.boundOrganizationId}::uuid
        and account_id = ${pointerAccountId}
        and content_digest = ${current.envelope_digest}`;
    if (!envelope) {
      await tx`delete from trader_live_capital_envelope_current_v2
        where organization_id = ${input.boundOrganizationId}::uuid and account_id = ${pointerAccountId}`;
      return refused("LIVE_CAPITAL_ENVELOPE_ABSENT", true);
    }
    const command = commandFromBody(envelope.body_text);
    const receipt = sealLiveCapitalEnvelopeV2(command);
    if (receipt.contentDigest !== current.envelope_digest)
      throw new RiskCurrentAccountRefusedV1("RECORD_SEAL");
    const nowUtc = await dbNow(tx);
    const decision = decideLiveCapitalEnvelopeWindowV2({
      liveCapitalEnvelope: receipt,
      bound: { ...input.observed, nowUtc },
      sourceMethodQualified: await publishedSourceMethodQualified(
        tx,
        { organizationId: input.boundOrganizationId, accountId: pointerAccountId },
        current.envelope_digest,
      ),
    });
    if (decision.decision === "PUBLISHED" && current.basis_digest === decision.basisDigest) {
      return published(decision.envelopeDigest, decision.basisDigest, true);
    }
    const reason = windowRefusalReason(decision);
    const rows = await loadJournal(tx, command);
    if (!rows.some((row) => row.stage === "INVALIDATED")) {
      await journal(tx, command, "INVALIDATED", {
        envelopeDigest: current.envelope_digest,
        basisDigest: current.basis_digest,
        reason,
      });
    }
    await tx`delete from trader_live_capital_envelope_current_v2
      where organization_id = ${input.boundOrganizationId}::uuid and account_id = ${pointerAccountId}`;
    return {
      ...refused(reason, true),
      envelopeDigest: current.envelope_digest,
      basisDigest: current.basis_digest,
    };
  });
}

export type LiveCapitalBasisAdmissionV2 =
  | {
      decision: "BASIS_BOUND";
      basisDigest: string;
      envelopeDigest: string;
      allowanceId: null;
      orderId: null;
      invoked: false;
    }
  | {
      decision: "REFUSED";
      reason:
        | "LIVE_CAPITAL_ENVELOPE_ABSENT"
        | "LIVE_CAPITAL_ENVELOPE_STALE"
        | "LIVE_CAPITAL_IDENTITY_CHANGED";
      allowanceId: null;
      orderId: null;
      invoked: false;
    };

function absentAdmission(): LiveCapitalBasisAdmissionV2 {
  return {
    decision: "REFUSED",
    reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
    allowanceId: null,
    orderId: null,
    invoked: false,
  };
}

/** Issue, bind, and start all require this binding. The binding does not submit an order.
 *  Observed policy and release come from the caller. A stale or changed identity is invalidated once.
 */
export async function readLiveCapitalBasisAdmissionV2(
  sql: postgres.Sql,
  boundOrganizationId: string,
  accountId: string,
  observed: LiveCapitalObservedIdentityV2,
): Promise<LiveCapitalBasisAdmissionV2> {
  if (!boundOrganizationId) throw new RiskCurrentAccountRefusedV1("EXTERNAL_ORGANIZATION");
  requireObservedOrganization(observed, boundOrganizationId);
  return sql.begin(async (tx) => {
    await lockScope(tx, boundOrganizationId, accountId);
    const rows = await tx<{ envelope_digest: string; basis_digest: string | null }[]>`
      select envelope_digest, basis_digest
      from trader_live_capital_envelope_current_v2
      where organization_id = ${boundOrganizationId}::uuid and account_id = ${accountId}
      for update`;
    const row = rows[0];
    if (!row?.basis_digest) return absentAdmission();
    const settled = await recheckPublishedAuthorityV2(
      tx,
      observed,
      { organizationId: boundOrganizationId, accountId },
      row.envelope_digest,
      row.basis_digest,
    );
    if (settled.decision === "PUBLISHED" && settled.basisDigest && settled.envelopeDigest) {
      return {
        decision: "BASIS_BOUND",
        basisDigest: settled.basisDigest,
        envelopeDigest: settled.envelopeDigest,
        allowanceId: null,
        orderId: null,
        invoked: false,
      };
    }
    const reason =
      settled.reason === "LIVE_CAPITAL_ENVELOPE_STALE" ||
      settled.reason === "LIVE_CAPITAL_IDENTITY_CHANGED" ||
      settled.reason === "LIVE_CAPITAL_ENVELOPE_ABSENT"
        ? settled.reason
        : "LIVE_CAPITAL_IDENTITY_CHANGED";
    return {
      decision: "REFUSED",
      reason,
      allowanceId: null,
      orderId: null,
      invoked: false,
    };
  });
}

export function gateLiveCapitalIssueV2(
  sql: postgres.Sql,
  boundOrganizationId: string,
  accountId: string,
  observed: LiveCapitalObservedIdentityV2,
): Promise<LiveCapitalBasisAdmissionV2> {
  return readLiveCapitalBasisAdmissionV2(sql, boundOrganizationId, accountId, observed);
}

export function gateLiveCapitalStartV2(
  sql: postgres.Sql,
  boundOrganizationId: string,
  accountId: string,
  observed: LiveCapitalObservedIdentityV2,
): Promise<LiveCapitalBasisAdmissionV2> {
  return readLiveCapitalBasisAdmissionV2(sql, boundOrganizationId, accountId, observed);
}
