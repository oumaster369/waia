import type postgres from "postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  parseRiskAccountProfileV1,
  riskAccountDigestV1,
  RiskCurrentAccountRefusedV1,
  type RiskAccountProfileV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import {
  readCurrentAccountAuthorityV1,
  type CurrentAccountAuthorityV1,
} from "@/lib/trader/risk/v2/risk-current-account-read-v1";

const NON_AUTHORITY_ACTIONS = ["PROPOSE", "CANCEL", "REVOKE"] as const;
const ACTIVATION_ACTIONS = ["CONFIRM", "ACTIVATE"] as const;

export type RiskAccountProfileCommandActionV1 =
  | (typeof NON_AUTHORITY_ACTIONS)[number]
  | (typeof ACTIVATION_ACTIONS)[number];

/** A profile command never copies allocation into a current pointer or an order.
 *  CONFIRM and ACTIVATE stay closed until a live envelope producer exists.
 */
export function decideRiskAccountProfileCommandV1(input: {
  action: RiskAccountProfileCommandActionV1;
  liveCapitalEnvelope: null;
}): {
  decision: "NON_AUTHORITY";
  action: (typeof NON_AUTHORITY_ACTIONS)[number];
  currentPointer: null;
  basisWrite: null;
  allowanceId: null;
  orderId: null;
} {
  void input.liveCapitalEnvelope;
  if ((ACTIVATION_ACTIONS as readonly string[]).includes(input.action)) {
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  if (!(NON_AUTHORITY_ACTIONS as readonly string[]).includes(input.action)) {
    throw new RiskCurrentAccountRefusedV1("PROFILE_COMMAND_UNKNOWN");
  }
  return {
    decision: "NON_AUTHORITY",
    action: input.action as (typeof NON_AUTHORITY_ACTIONS)[number],
    currentPointer: null,
    basisWrite: null,
    allowanceId: null,
    orderId: null,
  };
}

/** Current-account bind entry. It does not call the ordinary paper binder.
 *  Every readable pointer still refuses, because no live envelope producer exists.
 */
export async function gateCurrentAccountExecutionBindV1(
  sql: postgres.Sql,
  organizationId: string,
  accountId: string,
): Promise<{
  decision: "REFUSED";
  reason: CurrentAccountAuthorityV1["reason"];
  bindInvoked: false;
}> {
  const authority = await readCurrentAccountAuthorityV1(sql, organizationId, accountId);
  return { decision: "REFUSED", reason: authority.reason, bindInvoked: false };
}

/** Stores a proposal only. The profile allocation is not copied into a current pointer, allowance, or order. */
export async function retainProposedRiskAccountProfileV1(
  sql: postgres.Sql,
  input: { profile: RiskAccountProfileV1; actorId: string; auditId: string; commandId: string },
): Promise<{
  decision: "RETAINED_NON_AUTHORITY";
  action: "PROPOSE";
  profileDigest: string;
  currentPointer: null;
  allowanceId: null;
  orderId: null;
}> {
  const command = decideRiskAccountProfileCommandV1({
    action: "PROPOSE",
    liveCapitalEnvelope: null,
  });
  if (command.action !== "PROPOSE" || command.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  const profile = parseRiskAccountProfileV1(input.profile);
  const { contentDigest, ...profileBody } = profile;
  const profileText = canonicalJsonString(profileBody);
  if (contentDigest !== riskAccountDigestV1(profileBody))
    throw new RiskCurrentAccountRefusedV1("PROFILE_SEAL");
  const eventBody = {
    schemaVersion: "risk-account-profile-event/v1" as const,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    profileDigest: contentDigest,
    action: "PROPOSE" as const,
    actorId: input.actorId,
    eventSequence: 1,
    previousEventDigest: null,
    commandId: input.commandId,
  };
  const eventText = canonicalJsonString(eventBody);
  const eventDigest = riskAccountDigestV1(eventBody);
  await sql.begin(async (tx) => {
    await tx`insert into trader_risk_account_profiles_v1
      (organization_id, account_id, content_digest, body_text, actor_id, audit_id)
      values (${profile.organizationId}::uuid, ${profile.accountId}, ${contentDigest}, ${profileText}, ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    await tx`insert into trader_risk_account_profile_events_v1
      (organization_id, account_id, content_digest, body_text, command_id, profile_digest, event_sequence, previous_event_digest, action, actor_id, audit_id)
      values (${profile.organizationId}::uuid, ${profile.accountId}, ${eventDigest}, ${eventText}, ${input.commandId}::uuid, ${contentDigest}, 1, null, 'PROPOSE', ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    const [current] = await tx<
      { n: number }[]
    >`select count(*)::int n from trader_risk_account_current_v1
      where organization_id = ${profile.organizationId}::uuid and account_id = ${profile.accountId}`;
    if (current?.n !== 0) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  });
  return {
    decision: "RETAINED_NON_AUTHORITY",
    action: "PROPOSE",
    profileDigest: contentDigest,
    currentPointer: null,
    allowanceId: null,
    orderId: null,
  };
}

const STORED_PROFILE_ACTIONS = ["PROPOSE", "CANCEL", "REVOKE", "CONFIRM", "ACTIVATE"] as const;

/** A stored profile, including its allocation figure, never becomes trading authority. */
export async function readStoredProfileAuthorityV1(
  sql: postgres.Sql,
  organizationId: string,
  accountId: string,
): Promise<{
  action: (typeof STORED_PROFILE_ACTIONS)[number] | "ABSENT";
  authority: "NONE";
  currentPointer: null;
  allocationCopied: false;
}> {
  const [row] = await sql<{ action: string; approved_notional: string | null }[]>`
    select e.action, p.body_text::jsonb #>> '{allocation,approvedNotional}' as approved_notional
    from trader_risk_account_profile_events_v1 e
    join trader_risk_account_profiles_v1 p
      on p.organization_id = e.organization_id
     and p.account_id = e.account_id
     and p.content_digest = e.profile_digest
    where e.organization_id = ${organizationId}::uuid and e.account_id = ${accountId}
    order by e.event_sequence desc
    limit 1`;
  void row?.approved_notional;
  const action = row?.action;
  if (!(STORED_PROFILE_ACTIONS as readonly string[]).includes(action ?? "")) {
    return { action: "ABSENT", authority: "NONE", currentPointer: null, allocationCopied: false };
  }
  return {
    action: action as (typeof STORED_PROFILE_ACTIONS)[number],
    authority: "NONE",
    currentPointer: null,
    allocationCopied: false,
  };
}

/** Closes an open proposal. The cancel event does not create a current pointer, allowance, or order. */
export async function cancelStoredProfileProposalV1(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    accountId: string;
    actorId: string;
    auditId: string;
    commandId: string;
  },
): Promise<{
  decision: "RETAINED_NON_AUTHORITY";
  action: "CANCEL";
  profileDigest: string;
  currentPointer: null;
  allowanceId: null;
  orderId: null;
}> {
  const command = decideRiskAccountProfileCommandV1({
    action: "CANCEL",
    liveCapitalEnvelope: null,
  });
  if (command.action !== "CANCEL" || command.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  return sql.begin(async (tx) => {
    const [head] = await tx<
      { content_digest: string; event_sequence: string; profile_digest: string; action: string }[]
    >`
      select content_digest, event_sequence::text, profile_digest, action
      from trader_risk_account_profile_events_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}
      order by event_sequence desc
      limit 1
      for update`;
    if (!head) throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_ABSENT");
    if (head.action !== "PROPOSE")
      throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_NOT_OPEN");
    const eventSequence = Number(head.event_sequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) {
      throw new RiskCurrentAccountRefusedV1("EXPECTED_SEQUENCE");
    }
    const eventBody = {
      schemaVersion: "risk-account-profile-event/v1" as const,
      organizationId: input.organizationId,
      accountId: input.accountId,
      profileDigest: head.profile_digest,
      action: "CANCEL" as const,
      actorId: input.actorId,
      eventSequence: eventSequence + 1,
      previousEventDigest: head.content_digest,
      commandId: input.commandId,
    };
    const eventText = canonicalJsonString(eventBody);
    const eventDigest = riskAccountDigestV1(eventBody);
    await tx`insert into trader_risk_account_profile_events_v1
      (organization_id, account_id, content_digest, body_text, command_id, profile_digest, event_sequence, previous_event_digest, action, actor_id, audit_id)
      values (${input.organizationId}::uuid, ${input.accountId}, ${eventDigest}, ${eventText}, ${input.commandId}::uuid,
        ${head.profile_digest}, ${eventSequence + 1}, ${head.content_digest}, 'CANCEL', ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    const [current] = await tx<
      { n: number }[]
    >`select count(*)::int n from trader_risk_account_current_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}`;
    if (current?.n !== 0) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
    return {
      decision: "RETAINED_NON_AUTHORITY" as const,
      action: "CANCEL" as const,
      profileDigest: head.profile_digest,
      currentPointer: null,
      allowanceId: null,
      orderId: null,
    };
  });
}

/** Reads the stored proposal, then refuses confirmation or activation without appending an event. */
export async function refuseStoredProfileActivationV1(
  sql: postgres.Sql,
  input: { organizationId: string; accountId: string; action: "CONFIRM" | "ACTIVATE" },
): Promise<never> {
  await readStoredProfileAuthorityV1(sql, input.organizationId, input.accountId);
  decideRiskAccountProfileCommandV1({ action: input.action, liveCapitalEnvelope: null });
  throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
}

/** Revocation needs an active current pointer. An empty pointer appends no event. */
export async function revokeStoredProfileAuthorityV1(
  sql: postgres.Sql,
  input: { organizationId: string; accountId: string },
): Promise<never> {
  const command = decideRiskAccountProfileCommandV1({
    action: "REVOKE",
    liveCapitalEnvelope: null,
  });
  if (command.currentPointer !== null || command.allowanceId !== null || command.orderId !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  await sql.begin(async (tx) => {
    const rows = await tx<{ organization_id: string }[]>`
      select organization_id from trader_risk_account_current_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}
      for update`;
    if (rows.length === 0) throw new RiskCurrentAccountRefusedV1("PROFILE_AUTHORITY_ABSENT");
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  });
  throw new RiskCurrentAccountRefusedV1("PROFILE_AUTHORITY_ABSENT");
}
