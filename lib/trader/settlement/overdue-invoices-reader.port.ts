export type OverdueIssuedInvoice = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  issuedAt: Date;
};

export type OverdueInvoicesReader = {
  listOverdueIssuedInvoices(
    asOf: Date,
    gracePeriodMs: number,
    limit?: number,
  ): Promise<OverdueIssuedInvoice[]>;
  countOverdueIssuedInvoices(asOf: Date, gracePeriodMs: number): Promise<number>;
};
