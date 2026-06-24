import type {
  HwmLedgerRecordPayload,
  HwmLedgerRecordView,
} from "@/lib/trader/billing/hwm-ledger.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type InsertHwmLedgerEntryRepoInput = {
  payload: HwmLedgerRecordPayload;
};

export type ListHwmLedgerQuery = {
  exchangeAccountId?: string;
  limit?: number;
};

export const DEFAULT_HWM_LEDGER_LIST_LIMIT = 50;
export const MAX_HWM_LEDGER_LIST_LIMIT = 200;

export type HwmLedgerRepository = {
  insertEntry(
    context: OrgContext,
    input: InsertHwmLedgerEntryRepoInput,
  ): HwmLedgerRecordView | Promise<HwmLedgerRecordView>;

  getCurrentEntry(
    context: OrgContext,
    exchangeAccountId: string,
  ): HwmLedgerRecordView | null | Promise<HwmLedgerRecordView | null>;

  findBootstrapEntry(
    context: OrgContext,
    exchangeAccountId: string,
  ): HwmLedgerRecordView | null | Promise<HwmLedgerRecordView | null>;

  getById(
    context: OrgContext,
    id: string,
  ): HwmLedgerRecordView | null | Promise<HwmLedgerRecordView | null>;

  listEntries(
    context: OrgContext,
    query?: ListHwmLedgerQuery,
  ): HwmLedgerRecordView[] | Promise<HwmLedgerRecordView[]>;
};
