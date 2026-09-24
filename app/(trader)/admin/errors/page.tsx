"use client";
import * as React from "react";
import { useConsoleStreamList } from "@/components/trader/admin-console/data/console-stream-list";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleEmpty,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { RenderAckMarker } from "@/components/trader/admin-console/data/render-ack";
import {
  nextIncidentStatus,
  INCIDENT_STATUSES,
  type IncidentStatus,
} from "@/lib/trader/admin-console/diagnostics/incident-transition";
type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  status: IncidentStatus;
  occurrences: number;
  revision: string;
  service: string;
  firstSeenAt: string;
  lastSeenAt: string;
  stateVersion: number;
  mutedUntil: string | null;
  entityVersion?: string;
  eventId?: string;
  acceptedAt?: string;
};
type DiagnosticItem = {
  id: string;
  occurredAt: string;
  service: string;
  severity: string;
  errorClass: string;
  message: string;
  route: string | null;
};
const LABELS: Record<IncidentStatus, string> = {
  new: "Новый",
  investigating: "Разбираемся",
  fix_prepared: "Исправление подготовлено",
  deployed_verifying: "Проверяем на проде",
  resolved: "Исправлен",
  regressed: "Возник повторно",
};
export default function AdminErrorsPage() {
  const context = useAdminReadContext();
  const tab = context.params.get("tab") ?? "active";
  return tab === "events" ? (
    <DiagnosticEvents />
  ) : (
    <Incidents key={context.query + tab} tab={tab} />
  );
}
function DiagnosticEvents() {
  const context = useAdminReadContext();
  const { items, reason } = useConsoleStreamList<DiagnosticItem>(
    context.href("/api/trader/admin/console/incidents?tab=events"),
    "diagnostics",
  );
  return (
    <div className="space-y-4">
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {!items && !reason ? <ConsoleLoading /> : null}
      {items ? (
        <ConsolePanel
          title="Поток ошибок"
          note="Сохранённые диагностические события за выбранный период. Секреты и содержимое внутренней памяти не выводятся."
        >
          <ConsoleTable
            rows={items}
            caption="Диагностические события"
            rowKey={(row) => row.id}
            columns={[
              { title: "Когда", render: (row) => <EvidenceTime at={row.occurredAt} label="" /> },
              {
                title: "Источник",
                render: (row) => (
                  <div>
                    <p>{row.service}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.errorClass}</p>
                  </div>
                ),
              },
              {
                title: "Уровень",
                render: (row) => (
                  <ConsoleBadge tone={row.severity === "warning" ? "warning" : "danger"}>
                    {row.severity}
                  </ConsoleBadge>
                ),
              },
              {
                title: "Сообщение",
                render: (row) => <p className="max-w-xl leading-6 break-words">{row.message}</p>,
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
function Incidents({ tab }: { tab: string }) {
  const context = useAdminReadContext();
  const [refresh, reload] = React.useReducer((n: number) => n + 1, 0);
  const { items, reason } = useConsoleStreamList<IncidentItem>(
    context.href(`/api/trader/admin/console/incidents?tab=${tab}&ui_refresh=${refresh}`),
    "incidents",
  );
  const selected = items?.find((item) => item.id === context.params.get("sel"));
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [draftFor, setDraftFor] = React.useState<string | null>(null);
  const identity = selected ? `${selected.id}:${selected.revision}` : null;
  const next = selected
    ? INCIDENT_STATUSES.find((status) => nextIncidentStatus(selected.status, status).ok)
    : null;
  const changeStatus = async () => {
    if (
      !selected ||
      !next ||
      pending ||
      inFlight.current ||
      draftFor !== identity ||
      !note.trim() ||
      !evidence.trim()
    )
      return;
    setPending(true);
    inFlight.current = true;
    setMessage(null);
    try {
      const response = await fetch(context.href("/api/trader/admin/console/incidents"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          expectedRevision: selected.revision,
          status: next,
          reason: note.trim(),
          evidence: evidence.trim(),
        }),
      });
      if (response.status === 401 || response.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      setMessage(
        response.status === 409
          ? "Инцидент изменился. Проверьте свежий статус перед повтором."
          : response.ok
            ? "Изменение записано. Обновляем подтверждённое состояние."
            : "Изменение не подтверждено. Проверьте состояние перед повтором.",
      );
    } catch {
      setMessage("Связь прервалась. Проверьте актуальное состояние перед повтором.");
    } finally {
      setPending(false);
      inFlight.current = false;
      setDraftFor(null);
      setNote("");
      setEvidence("");
      reload();
    }
  };
  return (
    <div className="space-y-4">
      {message ? (
        <p role="status" className="border-waia-rim rounded-lg border p-3 text-sm">
          {message}
        </p>
      ) : null}
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {!items && !reason ? <ConsoleLoading /> : null}
      {items ? (
        <ConsolePanel
          title={tab === "resolved" ? "Подтверждённые исправления" : "Активные инциденты"}
          note="Обоснованный NO_TRADE не является инцидентом. Скрытие уведомлений не меняет статус исправления."
        >
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Инциденты</caption>
                <thead className="border-waia-divider text-waia-fg-muted border-b text-xs">
                  <tr>
                    {["Инцидент", "Статус", "Повторений", "Последнее событие"].map((title) => (
                      <th key={title} scope="col" className="px-5 py-3 font-medium">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-waia-divider divide-y">
                  {items.map((item) => (
                    <tr
                      data-incident-id={item.id}
                      key={item.id}
                      className="hover:bg-waia-elevated/20"
                    >
                      <td className="px-5 py-4">
                        <DetailLink
                          onClick={() => {
                            context.update({ sel: item.id });
                            setNote("");
                            setEvidence("");
                            setDraftFor(null);
                          }}
                        >
                          {item.title}
                        </DetailLink>
                        <p className="text-waia-fg-muted mt-2 text-xs">
                          {item.service} · {item.severity}
                        </p>
                        {item.entityVersion ? (
                          <RenderAckMarker
                            topic="incidents"
                            entityId={`trader_admin_incident:${item.id}`}
                            entityVersion={item.entityVersion}
                            eventId={item.eventId}
                            acceptedAt={item.acceptedAt}
                          />
                        ) : null}
                      </td>
                      <td className="px-5 py-4">
                        <ConsoleBadge
                          tone={
                            item.status === "resolved"
                              ? "good"
                              : item.status === "new" || item.status === "regressed"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {LABELS[item.status]}
                        </ConsoleBadge>
                        {item.mutedUntil ? (
                          <p className="text-waia-fg-muted mt-2 text-[10px]">
                            Уведомления скрыты до <EvidenceTime at={item.mutedUntil} label="" />
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 tabular-nums">{item.occurrences}</td>
                      <td className="px-5 py-4 text-xs">
                        <EvidenceTime at={item.lastSeenAt} label="" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ConsoleEmpty
              title={
                tab === "resolved"
                  ? "Подтверждённых исправлений пока нет"
                  : "Активных инцидентов в этом охвате нет"
              }
            />
          )}
        </ConsolePanel>
      ) : null}
      <ConsoleDialog
        open={Boolean(selected)}
        onClose={() => context.update({ sel: null })}
        dismissible={!pending}
        title={selected?.title ?? "Инцидент"}
        description="Каждое изменение статуса требует причины и доказательства и сохраняется в истории."
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <ConsoleBadge>{LABELS[selected.status]}</ConsoleBadge>
              <span className="text-waia-fg-muted text-xs">Версия {selected.stateVersion}</span>
            </div>
            <p className="text-xs">
              <EvidenceTime at={selected.lastSeenAt} label="Последнее событие" />
            </p>
            {next ? (
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void changeStatus();
                }}
              >
                <p className="text-sm">
                  Следующий статус: <strong>{LABELS[next]}</strong>
                </p>
                <label className="grid gap-2 text-sm">
                  Причина
                  <textarea
                    required
                    disabled={pending}
                    className={`${controlClass} h-20 py-2`}
                    value={draftFor === identity ? note : ""}
                    onChange={(event) => {
                      if (draftFor !== identity) setEvidence("");
                      setDraftFor(identity);
                      setNote(event.target.value);
                    }}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Доказательство или ссылка
                  <textarea
                    required
                    disabled={pending}
                    className={`${controlClass} h-20 py-2`}
                    value={draftFor === identity ? evidence : ""}
                    onChange={(event) => {
                      if (draftFor !== identity) setNote("");
                      setDraftFor(identity);
                      setEvidence(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={pending || draftFor !== identity || !note.trim() || !evidence.trim()}
                  className={controlClass}
                >
                  {pending ? "Сохраняем…" : `Перевести: ${LABELS[next]}`}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </ConsoleDialog>
    </div>
  );
}
