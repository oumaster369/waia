"use client";
import { useAdminRead } from "../../data/use-admin-read";
import {
  ConsolePanel,
  ConsoleTable,
  ConsoleLoading,
  EvidenceTime,
} from "../../primitives/console-ui";
import { DataState } from "../../primitives/data-state";
import type { PromotionProposalSummary } from "@/lib/trader/admin-console/research/promotion-proposal";
export function PromotionProposals() {
  const read = useAdminRead<{ items: PromotionProposalSummary[] }>(
    "/api/trader/admin/console/proposals",
  );
  return (
    <ConsolePanel
      title="Предложения исследовательского контура"
      note="Предложение не назначает счёт, не продвигает стратегию и не открывает торговлю."
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <div className="p-5">
          <DataState state="unavailable" reason={read.reason} />
        </div>
      ) : (
        <div className="space-y-3 p-5">
          {read.envelope?.data.items.length ? (
            read.envelope.data.items.map((p) => (
              <details key={p.id} className="border-waia-divider rounded-lg border p-4">
                <summary className="cursor-pointer text-sm">
                  {p.symbols.join(", ") || "Инструменты не сохранены"} ·{" "}
                  {p.disposition === "pending" ? "Ожидает проверки" : p.disposition}
                  <span className="text-waia-fg-muted ml-3 text-xs">{p.proposalId ?? p.id}</span>
                </summary>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-medium">1. Предложение и гипотеза</h3>
                    <EvidenceTime at={p.createdAt} />
                    <p className="text-waia-fg-muted mt-2 text-xs break-all">
                      {p.digests.hypothesis ?? "Гипотеза не сохранена"}
                    </p>
                  </section>
                  {(
                    [
                      ["positive", "2. Подтверждающие доказательства"],
                      ["negative", "3. Противоречащие доказательства"],
                    ] as const
                  ).map(([key, label]) => (
                    <section key={key}>
                      <h3 className="mb-2 text-sm font-medium">{label}</h3>
                      <ConsoleTable
                        rows={p.evidence[key]}
                        rowKey={(r) => r.id}
                        caption={label}
                        columns={[
                          { title: "Исход", render: (r) => r.polarity },
                          {
                            title: "Связь со сделкой",
                            render: (r) => (
                              <span className="text-xs break-all">
                                {r.tradeRef || "Не сохранена"}
                              </span>
                            ),
                          },
                        ]}
                      />
                    </section>
                  ))}
                  <section>
                    <h3 className="text-sm font-medium">4. Квалификация и кандидат</h3>
                    {Object.entries(p.digests)
                      .filter(([k]) => k !== "hypothesis")
                      .map(([key, value]) => (
                        <details className="mt-2 text-xs" key={key}>
                          <summary className="cursor-pointer">
                            {
                              {
                                candidate: "Кандидат",
                                development: "Development",
                                walkForward: "Walk-forward",
                              }[key as "candidate"]
                            }
                          </summary>
                          <p className="mt-1 break-all">{value ?? "Не сохранено"}</p>
                        </details>
                      ))}
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">5. Предложенные инструменты</h3>
                    <p className="text-sm">{p.symbols.join(", ") || "Не сохранены"}</p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">6. Назначение счетов</h3>
                    <DataState state="unavailable" reason={p.assignmentReason} />
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">7. Решение оператора</h3>
                    <p className="text-waia-fg-muted text-sm">
                      Требуется отдельная проверка и управляемое продвижение. Эта карточка только
                      показывает предложение.
                    </p>
                    <p className="mt-2 text-xs">
                      Полномочие капитала: {p.capitalAuthority ?? "не установлено"}; утверждение:{" "}
                      {p.approvalAuthority ?? "не установлено"}.
                    </p>
                  </section>
                </div>
              </details>
            ))
          ) : (
            <p className="text-waia-fg-muted text-sm">
              В выбранном периоде и охвате предложений нет.
            </p>
          )}
        </div>
      )}
    </ConsolePanel>
  );
}
