"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  FINANCE_ORG_STORAGE_KEY,
  readStoredFinanceOrganizationId,
  storeFinanceOrganizationId,
} from "@/lib/treasury-admin/org";

type FinanceOrgContextValue = {
  organizationId: string | null;
  setOrganizationId: (id: string) => void;
};

const FinanceOrgContext = React.createContext<FinanceOrgContextValue | null>(null);

export function FinanceOrgProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = searchParams.get("organization_id")?.trim() || null;

  React.useEffect(() => {
    if (fromUrl) {
      storeFinanceOrganizationId(fromUrl);
      return;
    }
    const stored = readStoredFinanceOrganizationId();
    if (!stored) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("organization_id", stored);
    router.replace(`${pathname}?${next.toString()}`);
  }, [fromUrl, pathname, router, searchParams]);

  const setOrganizationId = React.useCallback(
    (id: string) => {
      storeFinanceOrganizationId(id);
      const next = new URLSearchParams(searchParams.toString());
      next.set("organization_id", id);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const value = React.useMemo(
    () => ({ organizationId: fromUrl, setOrganizationId }),
    [fromUrl, setOrganizationId],
  );

  return <FinanceOrgContext.Provider value={value}>{children}</FinanceOrgContext.Provider>;
}

export function useFinanceOrg(): FinanceOrgContextValue {
  const ctx = React.useContext(FinanceOrgContext);
  if (!ctx) {
    throw new Error("useFinanceOrg must be used within FinanceOrgProvider");
  }
  return ctx;
}

export { FINANCE_ORG_STORAGE_KEY };
