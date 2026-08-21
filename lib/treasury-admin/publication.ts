export type DetailPublicationState = "PRIVATE" | "DETAIL_PUBLIC" | "SUPERSEDED";

export type AccountingStatus =
  | "DETECTED"
  | "MANUAL_DRAFT"
  | "PLANNED"
  | "NEEDS_REVIEW"
  | "CLASSIFIED"
  | "VERIFIED"
  | "RECONCILIATION_REQUIRED"
  | "REJECTED"
  | "DUPLICATE";

export function publicationLabel(state: DetailPublicationState): string {
  switch (state) {
    case "PRIVATE":
      return "Private";
    case "DETAIL_PUBLIC":
      return "Public detail";
    case "SUPERSEDED":
      return "Superseded";
  }
}

export function canExposeDetailPublicAction(status: AccountingStatus): boolean {
  return status === "VERIFIED";
}

export function isPublicRecentActivityEligible(input: {
  status: AccountingStatus;
  detailPublication: DetailPublicationState;
}): boolean {
  return input.status === "VERIFIED" && input.detailPublication === "DETAIL_PUBLIC";
}
