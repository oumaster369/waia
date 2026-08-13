import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  TreasuryAttributionRecord,
  TreasuryCommitmentRecord,
  TreasuryCommitmentRevisionRecord,
  TreasuryEvidenceLinkRecord,
  TreasuryInceptionRecord,
  TreasuryObservationRecord,
  TreasuryRevisionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

export type TreasuryRepository = {
  getTransaction(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryTransactionRecord | null>;
  insertTransaction(record: TreasuryTransactionRecord): Promise<void>;
  updateTransaction(
    context: OrgContext,
    transactionId: string,
    patch: Partial<TreasuryTransactionRecord>,
  ): Promise<TreasuryTransactionRecord>;
  listLinkedObservations(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryObservationRecord[]>;
  listEvidenceLinks(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryEvidenceLinkRecord[]>;
  insertEvidenceLink(record: TreasuryEvidenceLinkRecord): Promise<void>;
  deleteEvidenceLink(context: OrgContext, linkId: string): Promise<void>;
  insertObservation(record: TreasuryObservationRecord): Promise<void>;
  updateObservationLifecycle(
    context: OrgContext,
    observationId: string,
    patch: {
      observationStatus: TreasuryObservationRecord["observationStatus"];
      confirmationsObserved: number;
    },
  ): Promise<void>;
  insertObservationLink(input: {
    id: string;
    organizationId: string;
    transactionId: string;
    observationId: string;
    observationRole: "PRIMARY" | "INTERNAL_COUNTERPARTY" | "SECONDARY";
  }): Promise<void>;
  listRevisions(context: OrgContext, transactionId: string): Promise<TreasuryRevisionRecord[]>;
  insertRevision(record: TreasuryRevisionRecord): Promise<void>;
  getNextRevisionSeq(context: OrgContext, transactionId: string): Promise<number>;

  getCommitment(
    context: OrgContext,
    commitmentId: string,
  ): Promise<TreasuryCommitmentRecord | null>;
  insertCommitment(record: TreasuryCommitmentRecord): Promise<void>;
  updateCommitment(
    context: OrgContext,
    commitmentId: string,
    patch: Partial<TreasuryCommitmentRecord>,
  ): Promise<TreasuryCommitmentRecord>;
  listCommitments(
    context: OrgContext,
    query?: { budgetId?: string | null; statuses?: TreasuryCommitmentRecord["status"][] },
  ): Promise<TreasuryCommitmentRecord[]>;
  listCommitmentRevisions(
    context: OrgContext,
    commitmentId: string,
  ): Promise<TreasuryCommitmentRevisionRecord[]>;
  insertCommitmentRevision(record: TreasuryCommitmentRevisionRecord): Promise<void>;
  getNextCommitmentRevisionSeq(context: OrgContext, commitmentId: string): Promise<number>;

  listInceptions(context: OrgContext): Promise<TreasuryInceptionRecord[]>;
  getInception(context: OrgContext, inceptionId: string): Promise<TreasuryInceptionRecord | null>;
  getActiveInception(
    context: OrgContext,
    network: string,
    tokenContract: string,
  ): Promise<TreasuryInceptionRecord | null>;
  insertInception(record: TreasuryInceptionRecord): Promise<void>;
  updateInception(
    context: OrgContext,
    inceptionId: string,
    patch: Partial<Pick<TreasuryInceptionRecord, "status">>,
  ): Promise<TreasuryInceptionRecord>;

  listAttributions(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryAttributionRecord[]>;
  insertAttribution(record: TreasuryAttributionRecord): Promise<void>;
  listTransactions(
    context: OrgContext,
    query?: {
      status?: TreasuryTransactionRecord["status"];
      detailPublication?: TreasuryTransactionRecord["detailPublication"];
      kind?: TreasuryTransactionRecord["kind"];
      limit?: number;
      offset?: number;
    },
  ): Promise<TreasuryTransactionRecord[]>;
  getTransactionByCanonicalTransfer(
    context: OrgContext,
    query: {
      network: string;
      tokenContract: string;
      txHash: string;
      transferIndex: number;
    },
  ): Promise<TreasuryTransactionRecord | null>;
};
