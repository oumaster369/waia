import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  AppendObservationRevisionInput,
  MiObservationKind,
  PitObservation,
  RecordObservationInput,
} from "@/lib/trader/mi/observation.types";
import type {
  AppendMeasurementVersionInput,
  MiMeasurement,
  MiMeasurementKind,
  RegisterMeasurementInput,
} from "@/lib/trader/mi/measurement.types";
import type {
  AppendHypothesisVersionInput,
  HypothesisLifecycleTransitionInput,
  MiHypothesis,
  MiHypothesisKind,
  MiHypothesisLifecycleEvent,
  MiHypothesisLifecycleState,
  RegisterHypothesisInput,
} from "@/lib/trader/mi/hypothesis.types";
import type {
  MiEvidence,
  MiEvidenceDirection,
  MiEvidenceKind,
  RecordEvidenceInput,
} from "@/lib/trader/mi/evidence.types";
import type { MiTrial, RegisterTrialInput } from "@/lib/trader/mi/trial.types";
import type {
  AppendPatternVersionInput,
  MiPattern,
  MiPatternKind,
  MiPatternLifecycleEvent,
  MiPatternLifecycleState,
  PatternLifecycleTransitionInput,
  RegisterPatternInput,
} from "@/lib/trader/mi/pattern.types";
import type {
  CreateMiSourceInput,
  MiSourceIdentity,
  MiSourceStatus,
} from "@/lib/trader/mi/mi-source.types";
import type { AppendTrustRevisionInput, TrustRevision } from "@/lib/trader/mi/source-trust.types";

export type InsertTrustRevisionRow = {
  id: string;
  sourceId: string;
  trustScore: string;
  rationale: string;
  recordedBy: string;
  eventTime: Date;
  ingestTime: Date;
  revisionOf: string | null;
  revisionSeq: number;
  contentDigest: string;
  createdAt: Date;
};

export type MiSourceProvenanceRepository = {
  findSourceByLogicalKey: (
    context: OrgContext,
    venue: string,
    feedKind: string,
    symbol: string | null,
  ) => Promise<MiSourceIdentity | null> | MiSourceIdentity | null;
  getSourceById: (
    context: OrgContext,
    sourceId: string,
  ) => Promise<MiSourceIdentity | null> | MiSourceIdentity | null;
  insertSource: (
    context: OrgContext,
    input: CreateMiSourceInput,
    id: string,
    now: Date,
  ) => Promise<MiSourceIdentity> | MiSourceIdentity;
  updateSourceStatus: (
    context: OrgContext,
    sourceId: string,
    status: MiSourceStatus,
    now: Date,
  ) => Promise<MiSourceIdentity | null> | MiSourceIdentity | null;
  listSources: (context: OrgContext) => Promise<MiSourceIdentity[]> | MiSourceIdentity[];
  getLatestTrustRevision: (
    context: OrgContext,
    sourceId: string,
  ) => Promise<TrustRevision | null> | TrustRevision | null;
  listTrustHistory: (
    context: OrgContext,
    sourceId: string,
  ) => Promise<TrustRevision[]> | TrustRevision[];
  insertTrustRevision: (
    context: OrgContext,
    row: InsertTrustRevisionRow,
  ) => Promise<TrustRevision> | TrustRevision;
};

export type MiSourceProvenanceServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type SetSourceStatusInput = {
  status: MiSourceStatus;
  actorType?: MiSourceProvenanceServiceDeps["actorType"];
  actorId?: string | null;
};

export type CreateSourceServiceInput = CreateMiSourceInput & {
  actorType?: MiSourceProvenanceServiceDeps["actorType"];
  actorId?: string | null;
};

export type AppendTrustRevisionServiceInput = AppendTrustRevisionInput & {
  actorType?: MiSourceProvenanceServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertObservationRow = {
  id: string;
  sourceId: string;
  observationKind: MiObservationKind;
  observationKey: string;
  subjectRef: string;
  schemaVersion: string;
  payloadJson: string;
  eventTime: Date;
  ingestTime: Date;
  observedBy: string;
  revisionOf: string | null;
  revisionSeq: number;
  contentDigest: string;
  createdAt: Date;
};

export type MiObservationRepository = {
  getLatestObservation: (
    context: OrgContext,
    observationKey: string,
  ) => Promise<PitObservation | null> | PitObservation | null;
  listObservationHistory: (
    context: OrgContext,
    observationKey: string,
  ) => Promise<PitObservation[]> | PitObservation[];
  listObservations: (
    context: OrgContext,
    observationKind?: MiObservationKind,
  ) => Promise<PitObservation[]> | PitObservation[];
  findObservationById: (
    context: OrgContext,
    observationId: string,
  ) => Promise<PitObservation | null> | PitObservation | null;
  insertObservation: (
    context: OrgContext,
    row: InsertObservationRow,
  ) => Promise<PitObservation> | PitObservation;
};

export type MiObservationServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RecordObservationServiceInput = RecordObservationInput & {
  actorType?: MiObservationServiceDeps["actorType"];
  actorId?: string | null;
};

export type AppendObservationRevisionServiceInput = AppendObservationRevisionInput & {
  actorType?: MiObservationServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertMeasurementRow = {
  id: string;
  measurementKind: MiMeasurementKind;
  measurementKey: string;
  name: string;
  schemaVersion: string;
  definitionJson: string;
  definitionDigest: string;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type MiMeasurementRepository = {
  getLatestMeasurement: (
    context: OrgContext,
    measurementKey: string,
  ) => Promise<MiMeasurement | null> | MiMeasurement | null;
  listMeasurementHistory: (
    context: OrgContext,
    measurementKey: string,
  ) => Promise<MiMeasurement[]> | MiMeasurement[];
  listMeasurements: (
    context: OrgContext,
    measurementKind?: MiMeasurementKind,
  ) => Promise<MiMeasurement[]> | MiMeasurement[];
  findMeasurementByDigest: (
    context: OrgContext,
    definitionDigest: string,
  ) => Promise<MiMeasurement | null> | MiMeasurement | null;
  insertMeasurementVersion: (
    context: OrgContext,
    row: InsertMeasurementRow,
  ) => Promise<MiMeasurement> | MiMeasurement;
};

export type MiMeasurementServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RegisterMeasurementServiceInput = RegisterMeasurementInput & {
  actorType?: MiMeasurementServiceDeps["actorType"];
  actorId?: string | null;
};

export type AppendMeasurementVersionServiceInput = AppendMeasurementVersionInput & {
  actorType?: MiMeasurementServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertPatternRow = {
  id: string;
  patternKind: MiPatternKind;
  patternKey: string;
  name: string;
  schemaVersion: string;
  definitionJson: string;
  definitionDigest: string;
  structuralSignature: string;
  trialBudgetMax: number;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type InsertPatternLifecycleRow = {
  id: string;
  patternId: string;
  patternKey: string;
  lifecycleState: MiPatternLifecycleState;
  rationale: string;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

export type MiPatternRepository = {
  getLatestPattern: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPattern | null> | MiPattern | null;
  listPatternHistory: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPattern[]> | MiPattern[];
  listPatterns: (
    context: OrgContext,
    patternKind?: MiPatternKind,
  ) => Promise<MiPattern[]> | MiPattern[];
  findPatternByDigest: (
    context: OrgContext,
    definitionDigest: string,
  ) => Promise<MiPattern | null> | MiPattern | null;
  findActivePatternByStructuralSignature: (
    context: OrgContext,
    structuralSignature: string,
  ) => Promise<MiPattern | null> | MiPattern | null;
  insertPatternVersion: (
    context: OrgContext,
    row: InsertPatternRow,
  ) => Promise<MiPattern> | MiPattern;
  getLatestLifecycleEvent: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPatternLifecycleEvent | null> | MiPatternLifecycleEvent | null;
  listLifecycleEvents: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPatternLifecycleEvent[]> | MiPatternLifecycleEvent[];
  insertLifecycleEvent: (
    context: OrgContext,
    row: InsertPatternLifecycleRow,
  ) => Promise<MiPatternLifecycleEvent> | MiPatternLifecycleEvent;
};

export type MiPatternServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RegisterPatternServiceInput = RegisterPatternInput & {
  actorType?: MiPatternServiceDeps["actorType"];
  actorId?: string | null;
};

export type AppendPatternVersionServiceInput = AppendPatternVersionInput & {
  actorType?: MiPatternServiceDeps["actorType"];
  actorId?: string | null;
};

export type PatternLifecycleTransitionServiceInput = PatternLifecycleTransitionInput & {
  actorType?: MiPatternServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertHypothesisRow = {
  id: string;
  hypothesisKind: MiHypothesisKind;
  hypothesisKey: string;
  name: string;
  schemaVersion: string;
  definitionJson: string;
  definitionDigest: string;
  supersedesJson: string | null;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type InsertHypothesisLifecycleRow = {
  id: string;
  hypothesisId: string;
  hypothesisKey: string;
  lifecycleState: MiHypothesisLifecycleState;
  rationale: string;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

export type MiHypothesisRepository = {
  getLatestHypothesis: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesis | null> | MiHypothesis | null;
  listHypothesisHistory: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesis[]> | MiHypothesis[];
  listHypotheses: (
    context: OrgContext,
    hypothesisKind?: MiHypothesisKind,
  ) => Promise<MiHypothesis[]> | MiHypothesis[];
  findHypothesisByDigest: (
    context: OrgContext,
    definitionDigest: string,
  ) => Promise<MiHypothesis | null> | MiHypothesis | null;
  findHypothesisById: (
    context: OrgContext,
    hypothesisId: string,
  ) => Promise<MiHypothesis | null> | MiHypothesis | null;
  insertHypothesisVersion: (
    context: OrgContext,
    row: InsertHypothesisRow,
  ) => Promise<MiHypothesis> | MiHypothesis;
  getLatestLifecycleEvent: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesisLifecycleEvent | null> | MiHypothesisLifecycleEvent | null;
  listLifecycleEvents: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesisLifecycleEvent[]> | MiHypothesisLifecycleEvent[];
  insertLifecycleEvent: (
    context: OrgContext,
    row: InsertHypothesisLifecycleRow,
  ) => Promise<MiHypothesisLifecycleEvent> | MiHypothesisLifecycleEvent;
};

export type MiHypothesisServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RegisterHypothesisServiceInput = RegisterHypothesisInput & {
  actorType?: MiHypothesisServiceDeps["actorType"];
  actorId?: string | null;
};

export type AppendHypothesisVersionServiceInput = AppendHypothesisVersionInput & {
  actorType?: MiHypothesisServiceDeps["actorType"];
  actorId?: string | null;
};

export type HypothesisLifecycleTransitionServiceInput = HypothesisLifecycleTransitionInput & {
  actorType?: MiHypothesisServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertEvidenceRow = {
  id: string;
  evidenceKind: MiEvidenceKind;
  direction: MiEvidenceDirection;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  measurementRefsJson: string;
  observationRefsJson: string;
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  nullComparatorRef: string | null;
  regimeContextRef: string | null;
  trialRegistrationRef: string | null;
  createdAt: Date;
};

export type MiEvidenceRepository = {
  getLatestEvidence: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiEvidence | null> | MiEvidence | null;
  listEvidence: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiEvidence[]> | MiEvidence[];
  listEvidenceByDirection: (
    context: OrgContext,
    hypothesisKey: string,
    direction: MiEvidenceDirection,
  ) => Promise<MiEvidence[]> | MiEvidence[];
  findEvidenceById: (
    context: OrgContext,
    evidenceId: string,
  ) => Promise<MiEvidence | null> | MiEvidence | null;
  insertEvidence: (context: OrgContext, row: InsertEvidenceRow) => Promise<MiEvidence> | MiEvidence;
};

export type MiEvidenceServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RecordEvidenceServiceInput = RecordEvidenceInput & {
  actorType?: MiEvidenceServiceDeps["actorType"];
  actorId?: string | null;
};

export type InsertTrialRow = {
  id: string;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  researchProgram: string | null;
  eventTime: Date;
  ingestTime: Date;
  registeredBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

export type MiTrialRepository = {
  getLatestTrial: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiTrial | null> | MiTrial | null;
  listTrials: (context: OrgContext, hypothesisKey: string) => Promise<MiTrial[]> | MiTrial[];
  listTrialsByHypothesisId: (
    context: OrgContext,
    hypothesisId: string,
  ) => Promise<MiTrial[]> | MiTrial[];
  findTrialById: (context: OrgContext, trialId: string) => Promise<MiTrial | null> | MiTrial | null;
  insertTrial: (context: OrgContext, row: InsertTrialRow) => Promise<MiTrial> | MiTrial;
};

export type MiTrialServiceDeps = {
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void;
  actorType?: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
};

export type RegisterTrialServiceInput = RegisterTrialInput & {
  actorType?: MiTrialServiceDeps["actorType"];
  actorId?: string | null;
};
