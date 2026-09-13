/** Inert reference contracts, not a persistence schema or authenticated API. */
export type ModelScope = Readonly<{ organizationId: string; subjectId: string }>;
export type ObservationSource = "dialogue" | "diary";
export type ProjectionRisk =
  | "ambiguity"
  | "leading_question"
  | "missing_context"
  | "selection_bias"
  | "model_interpretation";
export type GrantReference = Readonly<{ id: string; version: number }>;

export type ModelConsentGrant = Readonly<{
  id: string;
  version: number;
  scope: ModelScope;
  purpose: string;
  sources: readonly ObservationSource[];
  mode: "private_modelling" | "raw_only";
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  retentionPolicyId: string;
}>;

/** Supplied by a future trusted server adapter, NEVER by request body or LLM output.
 * A matching subject string does not authenticate anyone. Current grants must come
 * from authoritative consent storage; this kernel cannot verify their origin. */
export type ModelContext = {
  scope: ModelScope;
  actor: { kind: "human" | "model"; subjectId: string };
  now: string;
  purpose: string;
  grants: readonly ModelConsentGrant[];
};

type CommandBase = { requestId: string; scope: ModelScope };
export type ObserveCommand = CommandBase & {
  kind: "observe";
  id: string;
  grant: GrantReference;
  source: ObservationSource;
  eventTime: string;
  context: string;
  text: string;
  projectionRisks: ProjectionRisk[];
};
export type ProposeCommand = CommandBase & {
  kind: "propose";
  claimId: string;
  statement: string;
  domain: string;
  context: string;
  uncertainty: string;
  observationIds: string[];
};
export type CorrectCommand = CommandBase & {
  kind: "correct";
  id: string;
  claimId: string;
  expectedRevision: number;
  action: "ratify" | "correct" | "dispute" | "contextualize";
  reason: string;
  statement: string | null;
  context: string | null;
};
export type ModelCommand = ObserveCommand | ProposeCommand | CorrectCommand;

export type ModelObservation = Readonly<
  Omit<ObserveCommand, "kind" | "requestId"> & {
    epistemicKind: "self_report";
    purpose: string;
    recordedAt: string;
    retentionPolicyId: string;
  }
>;
export type HumanClaimVersion = Readonly<
  Omit<ProposeCommand, "kind" | "requestId"> & {
    revision: number;
    purpose: string;
    supersedesRevision: number | null;
    status: "proposed" | "active" | "contested" | "superseded" | "withdrawn";
    /** Endorsement is not external verification or calibrated confidence. */
    basis: "model_interpretation" | "human_endorsed";
    recordedAt: string;
    humanCorrectionId: string | null;
  }
>;
export type HumanCorrectionRecord = Readonly<
  Omit<CorrectCommand, "kind" | "requestId" | "expectedRevision"> & {
    previousRevision: number;
    purpose: string;
    actorSubjectId: string;
    recordedAt: string;
  }
>;
export type ModelLedger = Readonly<{
  scope: ModelScope;
  lastRecordedAt: string | null;
  observations: readonly ModelObservation[];
  claims: readonly HumanClaimVersion[];
  corrections: readonly HumanCorrectionRecord[];
  /** Fingerprints are derived personal data, not anonymization or deletion proof. */
  receipts: readonly Readonly<{ requestId: string; fingerprint: string }>[];
}>;
