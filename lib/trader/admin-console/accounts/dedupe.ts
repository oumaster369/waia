import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

export type AccountCredential = {
  credentialId: string;
  organizationId: string;
  venue: string;
  exchangeAccountId: string;
  ownerEmail: string | null;
  createdAt: string;
};

export type DedupedAccount = {
  venue: string;
  exchangeAccountId: string;
  organizationIds: string[];
  credentials: AccountCredential[];
  credentialsCount: number;
  conflict: boolean;
  reason: string | null;
};

export function dedupeAccounts(rows: readonly AccountCredential[]): DedupedAccount[] {
  const groups = new Map<string, AccountCredential[]>();
  for (const row of rows) {
    const key = `${row.venue}:${row.exchangeAccountId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].map((credentials) => {
    const organizationIds = [...new Set(credentials.map((row) => row.organizationId))];
    const conflict = organizationIds.length > 1;
    return {
      venue: credentials[0]!.venue,
      exchangeAccountId: credentials[0]!.exchangeAccountId,
      organizationIds,
      credentials,
      credentialsCount: credentials.length,
      conflict,
      reason: conflict ? ADMIN_REASON.ownershipConflict : null,
    };
  });
}

export function firstConnectedAt(recordedAt: readonly string[]): string | null {
  if (recordedAt.length === 0) return null;
  return [...recordedAt].sort()[0] ?? null;
}
