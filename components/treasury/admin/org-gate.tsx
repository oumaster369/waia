"use client";

import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { EmptyState } from "@/components/treasury/admin/unavailable-state";

export function OrgGate({ children }: { children: React.ReactNode }) {
  const { organizationId } = useFinanceOrg();
  if (!organizationId) {
    return <EmptyState label="Select an organization to load Treasury facts." />;
  }
  return <>{children}</>;
}
