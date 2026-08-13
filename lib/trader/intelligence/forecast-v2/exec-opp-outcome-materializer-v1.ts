import { createHash } from "node:crypto";

import { EXEC_OPP_R_H_INDEX } from "@/lib/trader/intelligence/decision-economics/decision-economics-v2";
import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

/**
 * DEE-527 — PIT-safe bar → canonical 13-D Execution Opportunity outcome.
 *
 * Layout (§2.3):
 * [R_1,R_2,R_3,R_h,R_{h+1},R_{h+2},R_{h+3},V_1,V_2,V_3,V_{h+1},V_{h+2},V_{h+3}]
 *
 * R_k = log(P_{t+k}/P_t) — approved §2.3.
 * V_k = qualified authoritative HTX **base** volume at bar close t+k
 *       (volume-qualified bar semantics; never amount; never raw unauthoritative vol).
 *
 * Source fitting uses DEVELOPMENT corpus only. Future bars construct realized training
 * outcomes for already-defined historical anchors (no lookahead features).
 */

export const EXEC_OPP_OUTCOME_COMPONENT_COUNT = 13 as const;
export const EXEC_OPP_PRIMARY_HORIZONS_MINUTES = [30, 60] as const;

export type QualifiedDevelopmentBarV1 = {
  /** Exclusive close epoch ms of the 1m bar. */
  closedBarEpochMs: number;
  /** Close price P_t. */
  close: number;
  /**
   * Qualified authoritative HTX base volume for this bar.
   * Caller MUST supply only QUALIFIED capital-authority base volume.
   */
  qualifiedBaseVolume: number;
};

export type MaterializeExecOppOutcomeInput = {
  primaryHorizonMinutes: 30 | 60;
  /** Anchor bar close epoch ms (t). */
  anchorClosedBarEpochMs: number;
  /**
   * Bars indexed by closedBarEpochMs. Must include t and every required future offset.
   * Missing required bar/component => ineligible (null).
   */
  barsByCloseEpochMs: ReadonlyMap<number, QualifiedDevelopmentBarV1>;
};

export type MaterializeExecOppOutcomeResult =
  | {
      eligible: true;
      outcomeVersion: typeof OUTCOME_VERSION;
      outcome13d: readonly number[];
      rH: number;
      scale8Lines: readonly string[];
      outcomeContentDigestHex: string;
    }
  | { eligible: false; reason: "UNAVAILABLE"; detail: string };

const ONE_MINUTE_MS = 60_000;

function requiredReturnOffsets(h: 30 | 60): readonly number[] {
  return [1, 2, 3, h, h + 1, h + 2, h + 3];
}

function requiredVolumeOffsets(h: 30 | 60): readonly number[] {
  return [1, 2, 3, h + 1, h + 2, h + 3];
}

function logReturn(pFuture: number, pAnchor: number): number {
  if (!(pFuture > 0) || !(pAnchor > 0)) {
    throw new Error("[exec-opp-outcome] non-positive price");
  }
  return Math.log(pFuture / pAnchor);
}

/**
 * Deterministic PIT materializer. Returns UNAVAILABLE when any required bar/component
 * is missing or non-finite. Never invents volume or price.
 */
export function materializeExecOppOutcome13dV1(
  input: MaterializeExecOppOutcomeInput,
): MaterializeExecOppOutcomeResult {
  const h = input.primaryHorizonMinutes;
  if (h !== 30 && h !== 60) {
    return {
      eligible: false,
      reason: "UNAVAILABLE",
      detail: `unsupported primaryHorizonMinutes=${String(h)}`,
    };
  }

  const anchor = input.barsByCloseEpochMs.get(input.anchorClosedBarEpochMs);
  if (!anchor || !(anchor.close > 0)) {
    return {
      eligible: false,
      reason: "UNAVAILABLE",
      detail: "anchor bar missing or non-positive close",
    };
  }

  const rOffsets = requiredReturnOffsets(h);
  const vOffsets = requiredVolumeOffsets(h);
  const returns = new Map<number, number>();
  const volumes = new Map<number, number>();

  for (const k of rOffsets) {
    const epoch = input.anchorClosedBarEpochMs + k * ONE_MINUTE_MS;
    const bar = input.barsByCloseEpochMs.get(epoch);
    if (!bar || !(bar.close > 0)) {
      return {
        eligible: false,
        reason: "UNAVAILABLE",
        detail: `missing future close for offset k=${k}`,
      };
    }
    try {
      returns.set(k, logReturn(bar.close, anchor.close));
    } catch {
      return {
        eligible: false,
        reason: "UNAVAILABLE",
        detail: `invalid return at offset k=${k}`,
      };
    }
  }

  for (const k of vOffsets) {
    const epoch = input.anchorClosedBarEpochMs + k * ONE_MINUTE_MS;
    const bar = input.barsByCloseEpochMs.get(epoch);
    if (!bar || !Number.isFinite(bar.qualifiedBaseVolume) || bar.qualifiedBaseVolume < 0) {
      return {
        eligible: false,
        reason: "UNAVAILABLE",
        detail: `missing/invalid qualified base volume for offset k=${k}`,
      };
    }
    volumes.set(k, bar.qualifiedBaseVolume);
  }

  const outcome13d: number[] = [
    returns.get(1)!,
    returns.get(2)!,
    returns.get(3)!,
    returns.get(h)!,
    returns.get(h + 1)!,
    returns.get(h + 2)!,
    returns.get(h + 3)!,
    volumes.get(1)!,
    volumes.get(2)!,
    volumes.get(3)!,
    volumes.get(h + 1)!,
    volumes.get(h + 2)!,
    volumes.get(h + 3)!,
  ];

  if (outcome13d.length !== EXEC_OPP_OUTCOME_COMPONENT_COUNT) {
    return {
      eligible: false,
      reason: "UNAVAILABLE",
      detail: "outcome component count mismatch",
    };
  }

  const scale8Lines = outcome13d.map((v) => quantizeScale8HalfUp(v));
  const body = [OUTCOME_VERSION, ...scale8Lines.map((line) => `${line}\n`)].join("");
  const outcomeContentDigestHex = createHash("sha256").update(body, "utf8").digest("hex");

  return {
    eligible: true,
    outcomeVersion: OUTCOME_VERSION,
    outcome13d,
    rH: outcome13d[EXEC_OPP_R_H_INDEX]!,
    scale8Lines,
    outcomeContentDigestHex,
  };
}

/** Extract Terminal R_h from the SAME 13-D outcome vector (never a second calculation). */
export function terminalRhFromOutcome13dV1(outcome13d: readonly number[]): number {
  if (outcome13d.length !== EXEC_OPP_OUTCOME_COMPONENT_COUNT) {
    throw new Error("[exec-opp-outcome] outcome13d must have 13 components");
  }
  const rH = outcome13d[EXEC_OPP_R_H_INDEX];
  if (rH === undefined || !Number.isFinite(rH)) {
    throw new Error("[exec-opp-outcome] invalid R_h");
  }
  return rH;
}
