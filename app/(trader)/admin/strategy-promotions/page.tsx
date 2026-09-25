"use client";
import * as React from "react";
import Link from "next/link";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ConsolePanel,
  ConsoleLoading,
  ConsoleBadge,
  ConsoleDialog,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import type { StrategyWorkspace } from "@/lib/trader/admin-console/research/strategy-workspace";
import { buildStrategyPromotionRequestBody } from "@/lib/trader/validation-gate/promotion-request-body";
import { REQUIRED_EFFECTIVE_ACK } from "@/lib/trader/validation-gate/operator-promotion-inputs";

type RecordView = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  state: string;
  stateVersion: number;
  requestedAt: string | null;
  effectiveAt: string | null;
  coolingOffEndsAt: string | null;
};
type ReadView = { effective: RecordView | null; pending: RecordView | null };
const labels: Record<string, string> = {
  PENDING_CONFIRM: "Ожидает подтверждения",
  COOLING_OFF: "Подтверждено, период ожидания",
  EFFECTIVE: "Действует",
  CANCELLED: "Отменено",
  REVOKED: "Отозвано",
};
const actions: Record<string, { label: string; effect: string }> = {
  confirm: {
    label: "Подтвердить",
    effect: "Подтвердить проверку доказательств и начать предусмотренный шлюзом период ожидания.",
  },
  "mark-effective": {
    label: "Ввести в действие",
    effect:
      "Сделать это продвижение действующим после всех проверок и периода ожидания. Это отдельный шаг от разрешения Live.",
  },
  cancel: { label: "Отменить запрос", effect: "Отменить выбранное незавершённое продвижение." },
  demote: {
    label: "Отозвать продвижение",
    effect: "Отозвать действующее продвижение стратегии. Это не команда закрытия позиции.",
  },
};
export default function AdminStrategyPromotionsPage() {
  const context = useAdminReadContext();
  const catalogue = useAdminRead<StrategyWorkspace>("/api/trader/admin/console/strategies");
  const items = catalogue.envelope?.data.items ?? [],
    ids = [...new Set(items.map((r) => r.strategyId))];
  const org = context.params.get("organization_id"),
    strategy = context.params.get("strategy_id") ?? ids[0] ?? "";
  return (
    <div className="space-y-5">
      <Link
        className="text-waia-accent-cool text-sm hover:underline"
        href={context.href("/admin/strategies")}
      >
        ← Стратегии
      </Link>
      <ConsolePanel
        title="Управляемое продвижение"
        note="Проверка доказательств → подтверждение → период ожидания → введение в действие. Квалификация и разрешение Live проверяются отдельно."
      >
        <div className="space-y-4 p-5">
          <label className="block text-sm">
            Стратегия
            <select
              className={`${controlClass} ml-3 max-w-full`}
              value={strategy}
              onChange={(e) => context.update({ strategy_id: e.target.value })}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {items.find((r) => r.strategyId === id)?.displayName ?? id}
                </option>
              ))}
            </select>
          </label>
          {catalogue.reason ? <DataState state="unavailable" reason={catalogue.reason} /> : null}
          {!org ? (
            <p className="text-waia-fg-muted text-sm">
              Выберите клиента в шапке, чтобы прочитать его состояние продвижения.
            </p>
          ) : context.params.get("exchange_account_id") ? (
            <button
              className={controlClass}
              onClick={() => context.update({ exchange_account_id: null })}
            >
              Показать продвижения на уровне клиента
            </button>
          ) : strategy && !catalogue.reason && catalogue.envelope ? (
            <PromotionWorkspace
              key={`${org}:${strategy}:${context.query}`}
              org={org}
              strategy={strategy}
              versions={items.filter((r) => r.strategyId === strategy).map((r) => r.version)}
            />
          ) : (
            <p>Нет стратегий в каталоге.</p>
          )}
        </div>
      </ConsolePanel>
    </div>
  );
}
function PromotionWorkspace({
  org,
  strategy,
  versions,
}: {
  org: string;
  strategy: string;
  versions: string[];
}) {
  const [read, setRead] = React.useState<ReadView | null>(null),
    [loading, setLoading] = React.useState(true),
    [error, setError] = React.useState<string | null>(null),
    [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [readAt, setReadAt] = React.useState(0);
  const [busy, setBusy] = React.useState(false),
    [action, setAction] = React.useState<string | null>(null),
    [reason, setReason] = React.useState(""),
    [ack, setAck] = React.useState(false),
    [reviewed, setReviewed] = React.useState(false),
    [message, setMessage] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState(""),
    [research, setResearch] = React.useState(""),
    [version, setVersion] = React.useState(versions[0] ?? ""),
    [git, setGit] = React.useState(""),
    [hypothesis, setHypothesis] = React.useState(""),
    [regime, setRegime] = React.useState(""),
    [fees, setFees] = React.useState(""),
    [slippage, setSlippage] = React.useState(""),
    [failures, setFailures] = React.useState(""),
    [distribution, setDistribution] = React.useState("{}"),
    [edge, setEdge] = React.useState(""),
    [paper, setPaper] = React.useState(""),
    [downside, setDownside] = React.useState("");
  const controller = React.useRef<AbortController | null>(null),
    alive = React.useRef(true),
    idempotency = React.useRef<string | null>(null);
  const load = React.useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    setRead(null);
    setSelectedId(null);
    setAck(false);
    setReviewed(false);
    setAction(null);
    try {
      const res = await fetch(
        `/api/trader/admin/console/promotions?${new URLSearchParams({ organization_id: org, strategy_id: strategy })}`,
        { signal: abort.signal, cache: "no-store" },
      );
      const envelope = await res.json();
      const value = envelope.data;
      if (abort.signal.aborted || !alive.current) return;
      if (!res.ok) throw new Error(envelope.error?.code ?? "READ_FAILED");
      if (!value || ["unavailable", "not_applicable"].includes(value.state))
        throw new Error(value?.reasons?.[0] ?? "READ_FAILED");
      setReadAt(Date.parse(envelope.generatedAt) || Date.now());
      setRead(value);
      setSelectedId(value.pending?.id ?? value.effective?.id ?? null);
    } catch (e) {
      if (!abort.signal.aborted && alive.current)
        setError(e instanceof Error ? e.message : "READ_FAILED");
    } finally {
      if (!abort.signal.aborted && alive.current) setLoading(false);
    }
  }, [org, strategy]);
  React.useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      alive.current = false;
      controller.current?.abort();
    };
  }, [load]);
  const records = [read?.pending, read?.effective].filter((r): r is RecordView => !!r),
    selected = records.find((r) => r.id === selectedId);
  async function post(body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trader/admin/console/promotions/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await res.json();
      if (!alive.current) return;
      await load();
      if (!alive.current) return;
      setMessage(
        res.ok
          ? "Команда принята. Показано повторно прочитанное состояние."
          : res.status === 409
            ? "Состояние изменилось. Проверьте свежую запись и подтвердите действие заново."
            : `Команда отклонена: ${value.error?.code ?? "REQUEST_FAILED"}. ${value.error?.message ?? ""}`,
      );
    } catch {
      if (alive.current) {
        setRead(null);
        setAction(null);
        setError("COMMAND_RESULT_UNCONFIRMED");
        setMessage("Ответ не получен. Повторно прочитайте состояние перед следующей командой.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function requestPromotion() {
    if (!read || busy || read.pending || !reviewed) return;
    let reasons: unknown;
    try {
      reasons = JSON.parse(distribution);
    } catch {
      setMessage("Распределение причин должно быть корректным JSON-объектом.");
      return;
    }
    const inputs = {
      organizationId: org,
      strategyId: strategy,
      strategyVersion: version,
      gitCommitSha: git,
      hypothesis,
      intendedRegime: regime,
      costModel: { feesBps: fees, slippageBps: slippage },
      failureModes: failures
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      reasonCodeDistribution: reasons,
      confidenceAttestation: {
        edgeNetOfCosts: edge,
        liveTracksPaper: paper,
        downsideRiskBounded: downside,
      },
    };
    idempotency.current ??= crypto.randomUUID();
    const body = buildStrategyPromotionRequestBody({
      organizationId: org,
      strategyId: strategy,
      evidenceJson: evidence,
      researchEvidenceJson: research,
      inputsJson: JSON.stringify(inputs),
      idempotencyKey: idempotency.current,
    });
    if (!body.ok) {
      setMessage(
        "Загрузите два корректных документа доказательств и заполните основания оператора.",
      );
      return;
    }
    void post(body.body);
  }
  async function upload(file: File | undefined, set: (v: string) => void) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage("Документ превышает 2 МБ.");
      return;
    }
    try {
      const text = await file.text();
      JSON.parse(text);
      if (alive.current) {
        set(text);
        setReviewed(false);
        idempotency.current = null;
      }
    } catch {
      if (alive.current) setMessage("Файл не является корректным JSON-документом.");
    }
  }
  const field = (label: string, value: string, set: (v: string) => void, multiline = false) => (
    <label className="block text-sm">
      {label}
      {multiline ? (
        <textarea
          className={`${controlClass} mt-2 h-24 w-full py-2`}
          value={value}
          onChange={(e) => {
            set(e.target.value);
            setReviewed(false);
            idempotency.current = null;
          }}
        />
      ) : (
        <input
          className={`${controlClass} mt-2 w-full`}
          value={value}
          onChange={(e) => {
            set(e.target.value);
            setReviewed(false);
            idempotency.current = null;
          }}
        />
      )}
    </label>
  );
  return (
    <div className="space-y-5">
      {loading ? (
        <ConsoleLoading />
      ) : error ? (
        <>
          <DataState state="unavailable" reason={error} />
          <button className={controlClass} onClick={() => void load()}>
            Прочитать заново
          </button>
        </>
      ) : read ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {records.length ? (
              records.map((record) => (
                <button
                  key={record.id}
                  onClick={() => {
                    setSelectedId(record.id);
                    setAck(false);
                    setAction(null);
                  }}
                  className={`border-waia-divider rounded-lg border p-4 text-left ${selectedId === record.id ? "ring-waia-accent-cool ring-1" : ""}`}
                >
                  <ConsoleBadge>{labels[record.state] ?? record.state}</ConsoleBadge>
                  <p className="mt-3 text-sm">
                    {record.strategyId} · {record.strategyVersion}
                  </p>
                  <p className="text-waia-fg-muted mt-1 text-xs">
                    Версия состояния {record.stateVersion}
                  </p>
                  <EvidenceTime at={record.requestedAt} label="Запрошено" />
                  {record.coolingOffEndsAt ? (
                    <EvidenceTime at={record.coolingOffEndsAt} label="Ожидание до" />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="text-waia-fg-muted text-sm">
                Незавершённого и действующего продвижения нет.
              </p>
            )}
          </div>
          {selected ? (
            <div className="flex flex-wrap gap-2">
              {(selected.state === "PENDING_CONFIRM"
                ? ["confirm", "cancel"]
                : selected.state === "COOLING_OFF"
                  ? ["mark-effective", "cancel"]
                  : selected.state === "EFFECTIVE"
                    ? ["demote"]
                    : []
              ).map((command) => (
                <button
                  className={controlClass}
                  key={command}
                  disabled={busy}
                  onClick={() => {
                    setAction(command);
                    setReason("");
                    setAck(false);
                  }}
                >
                  {actions[command].label}
                </button>
              ))}
            </div>
          ) : null}
          <details className="border-waia-divider rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Новый запрос продвижения
            </summary>
            <div className="mt-5 space-y-5">
              <p className="text-waia-fg-muted text-sm">
                Доказательства проверяются существующим Strategy Validation Gate. Поля подтверждения
                заполняет оператор на основании проверенных документов.
              </p>
              {read.pending ? (
                <p className="text-waia-warning text-sm">
                  Сначала завершите или отмените текущий запрос.
                </p>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  Доказательства Paper
                  <input
                    aria-label="Доказательства Paper"
                    className="mt-2 block max-w-full text-xs"
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void upload(e.target.files?.[0], setEvidence)}
                  />
                  {evidence ? <span className="text-waia-success">Документ загружен</span> : null}
                </label>
                <label className="text-sm">
                  Доказательства исследования
                  <input
                    aria-label="Доказательства исследования"
                    className="mt-2 block max-w-full text-xs"
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void upload(e.target.files?.[0], setResearch)}
                  />
                  {research ? <span className="text-waia-success">Документ загружен</span> : null}
                </label>
                {field("Версия стратегии", version, setVersion)}
                {field("SHA проверенной реализации", git, setGit)}
                {field("Гипотеза", hypothesis, setHypothesis, true)}
                {field("Предполагаемый режим рынка", regime, setRegime)}
                {field("Комиссии, базисные пункты", fees, setFees)}
                {field("Проскальзывание, базисные пункты", slippage, setSlippage)}
                {field("Сценарии отказа, каждый с новой строки", failures, setFailures, true)}
                {field("Распределение кодов причин (JSON)", distribution, setDistribution, true)}
                {field("Подтверждение преимущества после издержек", edge, setEdge, true)}
                {field("Подтверждение соответствия Live и Paper", paper, setPaper, true)}
                {field("Подтверждение ограниченного риска потерь", downside, setDownside, true)}
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                Я проверил документы, выбранную версию и заполненные основания.
              </label>
              <button
                className={controlClass}
                disabled={busy || !!read.pending || !reviewed || !evidence || !research}
                onClick={requestPromotion}
              >
                Передать запрос в шлюз проверки
              </button>
            </div>
          </details>
        </>
      ) : null}
      <button className={controlClass} disabled={busy || loading} onClick={() => void load()}>
        Обновить состояние
      </button>
      {message ? (
        <p role="status" className="border-waia-divider rounded-lg border p-4 text-sm break-words">
          {message}
        </p>
      ) : null}
      {busy ? <ConsoleLoading label="Ожидаем результат и повторное чтение состояния…" /> : null}
      <ConsoleDialog
        open={!!action && !!selected}
        onClose={() => {
          if (!busy) setAction(null);
        }}
        title={action ? actions[action].label : "Подтверждение"}
      >
        {action && selected ? (
          <div className="space-y-4">
            <p className="text-sm">{actions[action].effect}</p>
            <p className="text-waia-fg-muted text-xs">
              {selected.strategyId} · {selected.strategyVersion} · версия состояния{" "}
              {selected.stateVersion}
            </p>
            {field("Причина действия", reason, setReason, true)}
            {action === "mark-effective" ? (
              <label className="flex items-start gap-3 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                Подтверждаю, что Paper-доказательства достаточны сверх одной лишь проверки
                инфраструктуры исторического воспроизведения.
              </label>
            ) : null}
            {action === "mark-effective" &&
            (!selected.coolingOffEndsAt || Date.parse(selected.coolingOffEndsAt) > readAt) ? (
              <p className="text-waia-warning text-sm">
                Период ожидания ещё не завершён или его окончание не подтверждено. Обновите
                состояние после указанного срока.
              </p>
            ) : null}
            <button
              className={controlClass}
              disabled={
                busy ||
                loading ||
                !reason.trim() ||
                (action === "mark-effective" &&
                  (!ack ||
                    !selected.coolingOffEndsAt ||
                    Date.parse(selected.coolingOffEndsAt) > readAt))
              }
              onClick={() =>
                void post({
                  command: action,
                  organization_id: org,
                  strategy_id: strategy,
                  record_id: selected.id,
                  expected_state_version: selected.stateVersion,
                  expectedRevision: `promotion:${selected.id}:${selected.stateVersion}`,
                  reason: reason.trim(),
                  ...(action === "mark-effective" && ack ? { ack: REQUIRED_EFFECTIVE_ACK } : {}),
                })
              }
            >
              Подтвердить действие
            </button>
          </div>
        ) : null}
      </ConsoleDialog>
    </div>
  );
}
