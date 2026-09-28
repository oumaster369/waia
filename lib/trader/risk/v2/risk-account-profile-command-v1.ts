import type postgres from "postgres";
import { RiskCurrentAccountRefusedV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
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
