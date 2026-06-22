import type { OrgContext } from "@/lib/waia-core/scope/org-context";
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
