export type ConnectedHtxAccountDto = Readonly<{
  organizationId: string;
  accountName: string;
  credentialId: string;
  exchangeAccountId: string;
  venue: "htx";
  status: "active";
  updatedAt: string;
}>;
