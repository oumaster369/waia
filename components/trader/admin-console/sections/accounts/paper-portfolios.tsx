"use client";
import { useAdminRead } from "../../data/use-admin-read";
import { useAdminReadContext } from "../../data/read-context";
import { DataState } from "../../primitives/data-state";
import {
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
  ConsoleLoading,
} from "../../primitives/console-ui";
import Link from "next/link";
export function PaperPortfolios() {
  const context = useAdminReadContext();
  const read = useAdminRead<{
    items: {
      id: string;
      organizationId: string;
      accountKey: string | null;
      orderCount: number;
      observedAt: string;
      reasons: string[];
      positions: { symbol: string; quantity: string }[] | null;
    }[];
  }>("/api/trader/admin/console/accounts/paper");
  if (read.loading) return <ConsoleLoading />;
  return (
    <ConsolePanel
      title="Виртуальные портфели Paper"
      note="Сохранённые paper-ордера и позиции. Реальные средства биржевых счетов сюда не входят; mock и исторические запуски исключены."
    >
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsoleTable
          rows={read.envelope.data.items}
          rowKey={(r) => r.id}
          caption="Виртуальные портфели"
          columns={[
            {
              title: "Портфель",
              render: (r) => (
                <div>
                  <p>{r.accountKey ?? "Привязка счёта не сохранена"}</p>
                  <span className="text-waia-fg-muted text-xs break-all">{r.organizationId}</span>
                </div>
              ),
            },
            {
              title: "Позиции",
              render: (r) =>
                r.positions === null ? (
                  <DataState
                    state="unavailable"
                    reason={r.reasons.find((v) => v !== "PAPER_INITIAL_CASH_NOT_PERSISTED")}
                  />
                ) : r.positions.length ? (
                  <ul>
                    {r.positions.map((p) => (
                      <li key={p.symbol}>
                        {p.symbol} · {p.quantity}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "Открытых позиций нет"
                ),
            },
            {
              title: "Капитал / свободно",
              render: () => (
                <DataState state="unavailable" reason="PAPER_INITIAL_CASH_NOT_PERSISTED" />
              ),
            },
            {
              title: "Ордера",
              render: (r) => (
                <Link
                  className="text-waia-accent-cool underline"
                  href={context.href(
                    `/admin/orders?organization_id=${r.organizationId}&mode=paper&tab=all`,
                  )}
                >
                  {r.orderCount} · открыть
                </Link>
              ),
            },
            { title: "Обновлено", render: (r) => <EvidenceTime at={r.observedAt} label="" /> },
          ]}
        />
      ) : null}
    </ConsolePanel>
  );
}
