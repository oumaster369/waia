import type { CredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";

/** Admin-only, fixed-target observation credential onboarding. No secret-bearing response fields. */
export type Org0ReadOnlyConnectResponse = Readonly<{
  target: Readonly<{
    organizationId: string;
    venue: "htx";
    exchangeAccountId: "73737331";
    marketType: "spot";
    requiredPermission: "read";
  }>;
  credential: CredentialMetadataDto | null;
}>;

/** The target and permissions are server-owned, never request fields. */
export type Org0ReadOnlyConnectPostBody = Readonly<{
  apiKey: string;
  apiSecret: string;
  expectedActiveCredentialId: string | null;
}>;
