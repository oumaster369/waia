"use client";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { ClientDetailsContent } from "@/components/trader/admin-console/sections/clients/client-details";
export type Client = {
  id: string;
  name: string;
  ownerEmail: string;
  access: string;
  connectedSince: string;
  registeredAt: string | null;
  connectedSinceValue?: string | null;
};
type Payment = {
  id: string;
  eventType: string;
  amount: string | null;
  asset: string | null;
  subjectInvoiceId: string | null;
  createdAt: string | null;
};
type Period = { id: string; exchangeAccountId: string; status: string; start: string; end: string };
type Dispute = {
  id: string;
  invoiceId: string;
  status: string;
  reason: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
};
export function ClientsWorkspace() {
  const { params, query } = useAdminReadContext();
  const tab = params.get("tab") ?? "clients";
  return tab === "invoices" ? (
    <InvoicesPanel key={query} />
  ) : tab === "payments" ? (
    <Payments />
  ) : tab === "periods" ? (
    <Periods />
  ) : tab === "disputes" ? (
    <Disputes />
  ) : (
    <Clients />
  );
}
function Clients() {
  const context = useAdminReadContext();
  const read = useAdminRead<{ items: Client[] }>("/api/trader/admin/console/clients");
  const rows = read.envelope?.data.items;
  const selected = rows?.find((item) => item.id === context.params.get("sel"));
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {rows ? (
        <ConsolePanel
          title="Клиенты AI-TRADER"
          note="Клиент с долгом или историей подключения остаётся видимым при отключённом доступе."
        >
          <ConsoleTable
            rows={rows}
            rowKey={(row) => row.id}
            caption="Клиенты AI-TRADER"
            columns={[
              {
                title: "Клиент",
                render: (row) => (
                  <div>
                    <DetailLink onClick={() => context.update({ sel: row.id })}>
                      {row.name || row.ownerEmail || row.id}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.ownerEmail}</p>
                  </div>
                ),
              },
              { title: "Доступ", render: (row) => <ConsoleBadge>{row.access}</ConsoleBadge> },
              {
                title: "Подключён с",
                render: (row) =>
                  row.connectedSinceValue ? (
                    <EvidenceTime at={row.connectedSinceValue} label="" />
                  ) : (
                    "Не установлена"
                  ),
              },
              {
                title: "Организация",
                render: (row) => (
                  <span className="text-waia-fg-muted font-mono text-[10px] break-all">
                    {row.id}
                  </span>
                ),
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
      <ConsoleDialog
        open={Boolean(selected)}
        onClose={() => context.update({ sel: null, detail: null, nested: null })}
        title={selected?.name || selected?.ownerEmail || "Клиент"}
        description="История и финансовые документы организации сохраняются независимо от текущего доступа."
        wide
      >
        {selected ? <ClientDetailsContent client={selected} /> : null}
      </ConsoleDialog>
    </div>
  );
}
export function Payments() {
  const read = useAdminRead<{ items: Payment[] }>("/api/trader/admin/console/payments");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Платежи AI-TRADER"
          note="Обнаруженная транзакция не означает зачёт платежа. Другие продукты в эту выборку не входят."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Платежи AI-TRADER"
            columns={[
              { title: "Событие", render: (row) => <ConsoleBadge>{row.eventType}</ConsoleBadge> },
              {
                title: "Сумма",
                align: "right",
                render: (row) =>
                  row.amount !== null && row.asset ? (
                    formatAdminMoney(row.amount, row.asset)
                  ) : (
                    <DataState state="unavailable" reason="PAYMENT_AMOUNT_NOT_RECORDED" />
                  ),
              },
              { title: "Счёт на оплату", render: (row) => row.subjectInvoiceId ?? "Не привязан" },
              {
                title: "Зарегистрировано",
                render: (row) => <EvidenceTime at={row.createdAt} label="" />,
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
export function Periods() {
  const read = useAdminRead<{ items: Period[] }>("/api/trader/admin/console/reporting-periods");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Отчётные периоды"
          note="Начало включено, окончание исключено: [start, end). Время показано по Москве."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Отчётные периоды"
            columns={[
              { title: "Биржевой счёт", render: (row) => row.exchangeAccountId },
              { title: "Начало", render: (row) => <EvidenceTime at={row.start} label="" /> },
              { title: "Окончание", render: (row) => <EvidenceTime at={row.end} label="" /> },
              { title: "Статус", render: (row) => <ConsoleBadge>{row.status}</ConsoleBadge> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
function Disputes() {
  const read = useAdminRead<{ items: Dispute[] }>("/api/trader/admin/console/disputes");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Споры и сверка"
          note="Исправления расчётов проходят существующий процесс биллинга; сохранённые суммы не подменяются."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Споры по счетам на оплату"
            columns={[
              { title: "Счёт на оплату", render: (row) => row.invoiceId },
              {
                title: "Статус",
                render: (row) => (
                  <ConsoleBadge tone={row.status === "OPEN" ? "warning" : "neutral"}>
                    {row.status}
                  </ConsoleBadge>
                ),
              },
              { title: "Причина", render: (row) => row.reason ?? "Причина не сохранена" },
              { title: "Открыт", render: (row) => <EvidenceTime at={row.openedAt} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
