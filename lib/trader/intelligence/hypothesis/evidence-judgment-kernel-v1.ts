/** Existing evidence policy. These pure data helpers grant no runtime authority. */
export type EvidenceJudgmentV1 = "SUPPORTED" | "CONTESTED" | "WEAKENED";
const JUDGMENT_ORDER = { SUPPORTED: 0, CONTESTED: 1, WEAKENED: 2 } as const;
export function partitionDirectionalEvidenceV1<T extends { direction: string }>(rows: readonly T[]) {
  return { supportingEvidence: rows.filter(row => row.direction === "FOR"),
    contradictingEvidence: rows.filter(row => row.direction === "AGAINST") };
}
export function judgeDirectionalEvidenceV1(hasVerified: boolean, supportingCount: number, contradictingCount: number): EvidenceJudgmentV1 {
  return hasVerified && supportingCount > contradictingCount ? "SUPPORTED"
    : contradictingCount > 0 ? "CONTESTED" : "WEAKENED";
}
export function rankEvidenceJudgmentsV1<T extends { ordinalJudgment: EvidenceJudgmentV1;
  supportingEvidence: readonly unknown[]; contradictingEvidence: readonly unknown[]; hypothesisKey: string; hypothesisId: string }>(candidates: readonly T[]) {
  return [...candidates].sort((a, b) =>
    JUDGMENT_ORDER[a.ordinalJudgment] - JUDGMENT_ORDER[b.ordinalJudgment] ||
    b.supportingEvidence.length - a.supportingEvidence.length ||
    a.contradictingEvidence.length - b.contradictingEvidence.length ||
    a.hypothesisKey.localeCompare(b.hypothesisKey) || a.hypothesisId.localeCompare(b.hypothesisId),
  ).map((row, rankOrdinal) => ({ ...row, rankOrdinal }));
}
