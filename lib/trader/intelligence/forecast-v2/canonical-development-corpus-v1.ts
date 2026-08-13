import { createHash } from "node:crypto";

import {
  materializeExecOppOutcome13dV1,
  type QualifiedDevelopmentBarV1,
} from "./exec-opp-outcome-materializer-v1";
import { canonicalizeSourceCorpusV1 } from "./source-corpus-canonical-v1";
import type { SourceAnchor } from "./source-anchor-v1";

/**
 * Canonical DEVELOPMENT corpus construction (DEE-527).
 * Outcomes are produced only by the PIT materializer — callers cannot substitute
 * an arbitrary unverified outcome13d into this authority path.
 */

export type CanonicalDevelopmentCorpusV1 = {
  readonly brand: "CanonicalDevelopmentCorpusV1";
  readonly primaryHorizonMinutes: 30 | 60;
  readonly anchors: readonly SourceAnchor[];
};

export type BuildCanonicalDevelopmentCorpusInput = {
  venue: string;
  market: string;
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  /**
   * Qualified DEVELOPMENT bars indexed by closedBarEpochMs.
   * Only QUALIFIED authoritative base volume may be supplied.
   */
  barsByCloseEpochMs: ReadonlyMap<number, QualifiedDevelopmentBarV1>;
  /**
   * Candidate anchor close epochs (features at t). Future bars are used only for outcomes.
   */
  candidateAnchorClosedBarEpochMs: readonly number[];
  /** Realized vol feature at each candidate anchor (PIT-safe; no lookahead). */
  realizedVol20m_1mByAnchorEpochMs: ReadonlyMap<number, number>;
};

function barContentDigest(bar: QualifiedDevelopmentBarV1): string {
  const body = [
    String(bar.closedBarEpochMs),
    String(bar.close),
    String(bar.qualifiedBaseVolume),
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Build the canonical DEVELOPMENT source corpus via PIT 13-D materialization.
 * Ineligible anchors (missing future bars/volumes) are omitted — never fabricated.
 */
export function buildCanonicalDevelopmentCorpusFromQualifiedBarsV1(
  input: BuildCanonicalDevelopmentCorpusInput,
): CanonicalDevelopmentCorpusV1 {
  const anchors: SourceAnchor[] = [];
  for (const anchorEpoch of input.candidateAnchorClosedBarEpochMs) {
    const materialized = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      anchorClosedBarEpochMs: anchorEpoch,
      barsByCloseEpochMs: input.barsByCloseEpochMs,
    });
    if (!materialized.eligible) {
      continue;
    }
    const anchorBar = input.barsByCloseEpochMs.get(anchorEpoch);
    const rv = input.realizedVol20m_1mByAnchorEpochMs.get(anchorEpoch);
    if (!anchorBar || rv === undefined || !Number.isFinite(rv)) {
      continue;
    }
    anchors.push({
      venue: input.venue,
      market: input.market,
      symbol: input.symbol,
      closedBarEpochMs: anchorEpoch,
      barContentDigest: barContentDigest(anchorBar),
      realizedVol20m_1m: rv,
      outcome13d: materialized.outcome13d,
    });
  }
  const canonical = canonicalizeSourceCorpusV1(anchors);
  return {
    brand: "CanonicalDevelopmentCorpusV1",
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    anchors: canonical,
  };
}

/**
 * TEST_ONLY / research helper: prebuilt outcome13d anchors.
 * Not a production capital authority path — cannot mint CanonicalDevelopmentCorpusV1 brand.
 */
export function testOnlySourceAnchorsWithPrebuiltOutcome13d(
  anchors: readonly SourceAnchor[],
): readonly SourceAnchor[] {
  return canonicalizeSourceCorpusV1(anchors);
}

export function sourceCorpusFromCanonicalDevelopment(
  corpus: CanonicalDevelopmentCorpusV1,
): readonly SourceAnchor[] {
  return corpus.anchors;
}
