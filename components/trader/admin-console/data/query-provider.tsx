"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { ADMIN_ACCESS_REVOKED_EVENT } from "@/components/trader/admin-console/data/access-events";

export function AdminQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient());
  const [revoked, setRevoked] = React.useState(false);
  React.useEffect(() => {
    const revoke = () => {
      void client.cancelQueries();
      client.clear();
      setRevoked(true);
    };
    window.addEventListener(ADMIN_ACCESS_REVOKED_EVENT, revoke);
    return () => window.removeEventListener(ADMIN_ACCESS_REVOKED_EVENT, revoke);
  }, [client]);
  if (revoked)
    return (
      <div
        role="alert"
        lang="ru"
        className="border-border bg-card text-foreground rounded-xl border p-6"
      >
        <h1 className="text-lg font-semibold">Доступ к консоли отозван</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Данные закрыты. Для продолжения нужен действующий допуск администратора.
        </p>
      </div>
    );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
