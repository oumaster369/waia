"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import type { AssistantFact } from "@/lib/trader/admin-console/assistant/facts";
type Props = { enabled?: boolean; answers?: readonly { id: string; title: string }[] };
type Message = {
  id: string;
  role: string;
  content: string;
  status: string;
  at: string;
  blocks?: { facts?: AssistantFact[]; unverified?: boolean } | null;
};
export function AssistantPanel(props: Props) {
  const context = useAdminReadContext();
  // A context switch destroys both in-flight requests and all previous answer state.
  return <AssistantContextPanel key={context.query} {...props} />;
}
function AssistantContextPanel(props: Props) {
  const context = useAdminReadContext();
  const catalog = useAdminRead<{ enabled: boolean; answers: { id: string; title: string }[] }>(
    "/api/trader/admin/console/assistant/quick-answers",
    { intervalMs: 0 },
  );
  const enabled = catalog.envelope?.data.enabled ?? props.enabled ?? false;
  const answers = catalog.envelope?.data.answers ?? props.answers ?? QUICK_ANSWERS;
  const [quick, setQuick] = React.useState<string | null>(null);
  const answer = useAdminRead<{ title: string; facts: AssistantFact[] }>(
    quick
      ? `/api/trader/admin/console/assistant/quick-answers?id=${encodeURIComponent(quick)}`
      : null,
    { intervalMs: 0 },
  );
  const conversations = useAdminRead<{ conversations: { id: string; title: string }[] }>(
    "/api/trader/admin/console/assistant/conversations",
    { intervalMs: 0 },
  );
  const [conversation, setConversation] = React.useState<string | null>(null);
  const history = useAdminRead<{ messages: Message[] }>(
    conversation ? `/api/trader/admin/console/assistant/conversations/${conversation}` : null,
    { intervalMs: 0 },
  );
  const [question, setQuestion] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  const [latest, setLatest] = React.useState<{
    id: string;
    facts: AssistantFact[];
    unverified: boolean;
    content: string;
  } | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enabled || pending || !question.trim()) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const content = question.trim();
    setPending(content);
    setReason(null);
    setLatest(null);
    const post = async (path: string, body: unknown) => {
      const response = await fetch(context.href(path), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) notifyAdminAccessRevoked();
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.code ?? "ASSISTANT_REQUEST_FAILED");
      if (result.data?.state === "unavailable")
        throw new Error(result.data.reasons?.[0] ?? "SOURCE_UNAVAILABLE");
      const query = new URLSearchParams(context.query);
      if (
        result.schemaVersion !== "admin-console/v1" ||
        (result.scope?.organizationId ?? null) !== (query.get("organization_id") ?? null) ||
        (result.scope?.exchangeAccountId ?? null) !== (query.get("exchange_account_id") ?? null) ||
        result.mode !== (query.get("mode") ?? "all")
      )
        throw new Error("ADMIN_SCOPE_MISMATCH");
      return result.data;
    };
    try {
      let id = conversation;
      if (!id) {
        const created = await post("/api/trader/admin/console/assistant/conversations", {
          title: "Разговор с помощником",
        });
        id = created.conversation.id;
        if (abort.signal.aborted) return;
        setConversation(id);
        conversations.reload();
      }
      const result = await post("/api/trader/admin/console/assistant/messages", {
        conversationId: id,
        content,
      });
      if (abort.signal.aborted) return;
      setLatest({
        id: result.messageId,
        facts: result.facts ?? [],
        unverified: result.unverified === true,
        content: result.content,
      });
      setQuestion("");
      history.reload();
    } catch (error) {
      if (!abort.signal.aborted)
        setReason(
          error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "ASSISTANT_REQUEST_FAILED",
        );
    } finally {
      if (!abort.signal.aborted) {
        setPending(null);
        history.reload();
      }
    }
  };
  const messages = history.envelope?.data.messages ?? [];
  const query = new URLSearchParams(context.query);
  return (
    <section aria-label="Ответы помощника" className="space-y-5 text-xs">
      <p className="text-waia-fg-muted leading-5">
        Только чтение. Ответы относятся к выбранному охвату, периоду, режиму и валюте.
      </p>
      <div className="border-waia-divider rounded-lg border p-3 leading-5">
        <span className="font-medium">
          {query.get("exchange_account_id")
            ? "Выбранный счёт"
            : query.get("organization_id")
              ? "Выбранный клиент"
              : "Весь парк"}
        </span>
        <span className="text-waia-fg-muted">
          {" "}
          · {query.get("mode") ?? "all"} · {query.get("currency") ?? "USDT"}
        </span>
        {!enabled ? (
          <p className="text-waia-fg-muted mt-2">
            Помощник выключен. Быстрые ответы работают без языковой модели.
          </p>
        ) : null}
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Быстрые ответы</h3>
        <div className="flex flex-wrap gap-2">
          {answers.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={quick === a.id}
              onClick={() => setQuick(a.id)}
              className={`${controlClass} h-auto min-h-9 text-left whitespace-normal ${quick === a.id ? "bg-waia-elevated" : ""}`}
            >
              {a.title}
            </button>
          ))}
        </div>
      </div>
      {quick ? (
        <section aria-label="Быстрый ответ" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{answer.envelope?.data.title ?? "Читаю источник…"}</h3>
            <button
              type="button"
              aria-label="Обновить быстрый ответ"
              onClick={answer.reload}
              className="hover:bg-waia-elevated rounded p-2"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {answer.loading ? (
            <p role="status">Получаю проверяемые данные…</p>
          ) : answer.reason ? (
            <DataState state="unavailable" reason={answer.reason} />
          ) : (
            <AssistantFacts facts={answer.envelope?.data.facts ?? []} />
          )}
        </section>
      ) : null}
      <div className="border-waia-divider border-t pt-4">
        <label htmlFor="assistant-history" className="mb-2 block font-semibold">
          Разговоры
        </label>
        <select
          id="assistant-history"
          className={`${controlClass} w-full`}
          value={conversation ?? ""}
          onChange={(e) => {
            controller.current?.abort();
            setPending(null);
            setConversation(e.target.value || null);
            setLatest(null);
            setReason(null);
          }}
        >
          <option value="">Новый разговор</option>
          {conversations.envelope?.data.conversations?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <p className="text-waia-fg-muted mt-2 leading-5">
          История показывает только сообщения текущего контекста. Данные старых ответов имеют свою
          дату и ревизию.
        </p>
        {conversation && !history.loading && !messages.length && !history.reason ? (
          <p className="text-waia-fg-muted mt-3">В этом контексте пока нет сообщений.</p>
        ) : null}
        {history.reason ? <DataState state="unavailable" reason={history.reason} /> : null}
        <div className="mt-4 space-y-4" role="log" aria-label="История сообщений">
          {messages.map((m) => (
            <article key={m.id} className="border-waia-divider rounded-lg border p-3">
              <p className="mb-2 font-semibold">{m.role === "user" ? "Вы" : "Помощник"}</p>
              {m.blocks?.facts?.length ? (
                <AssistantFacts facts={m.blocks.facts} />
              ) : (
                <p className="leading-5 break-words whitespace-pre-wrap">{m.content}</p>
              )}
              {m.blocks?.unverified ? (
                <p className="text-waia-fg-muted mt-2">Неподтверждённое утверждение удалено.</p>
              ) : null}
              <div className="mt-2 text-[10px]">
                <EvidenceTime at={m.at} />
              </div>
            </article>
          ))}
        </div>
        {latest && !messages.some((m) => m.id === latest.id) ? (
          <div className="mt-4">
            <AssistantFacts facts={latest.facts} />
            {latest.unverified ? (
              <p className="text-waia-fg-muted mt-2">Неподтверждённое утверждение удалено.</p>
            ) : null}
          </div>
        ) : null}
        {pending ? (
          <p role="status" className="mt-3 flex items-center gap-2">
            <LoaderCircle size={14} className="animate-spin" />
            Проверяю источники и готовлю ответ…
          </p>
        ) : null}
        {reason ? (
          <div className="mt-3">
            <DataState state="unavailable" reason={reason} />
            <p className="text-waia-fg-muted mt-2">Можно открыть быстрый ответ выше.</p>
          </div>
        ) : null}
        <form onSubmit={submit} className="mt-4 space-y-2">
          <label htmlFor="assistant-question" className="block font-semibold">
            Вопрос по данным консоли
          </label>
          <textarea
            id="assistant-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={4000}
            rows={3}
            disabled={!enabled || !!pending}
            placeholder={enabled ? "Что требует внимания?" : "Языковая модель выключена"}
            className={`${controlClass} h-auto w-full resize-y p-3 leading-5 disabled:opacity-60`}
          />
          <div className="flex justify-end gap-2">
            {pending ? (
              <button
                type="button"
                className={controlClass}
                onClick={() => {
                  controller.current?.abort();
                  setPending(null);
                  setReason("ASSISTANT_STOPPED");
                }}
              >
                Остановить ответ
              </button>
            ) : null}
            <button
              type="submit"
              className={`${controlClass} inline-flex items-center gap-2 disabled:opacity-50`}
              disabled={!enabled || !!pending || !question.trim()}
            >
              <ArrowUp size={14} />
              Отправить
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
export function AssistantFacts({ facts }: { facts: readonly AssistantFact[] }) {
  const revisions = new Set(facts.flatMap((f) => (f.financeRevision ? [f.financeRevision] : [])));
  return (
    <div className="space-y-3">
      {revisions.size > 1 ? (
        <p className="text-waia-fg-muted leading-5">
          Финансовые источники имеют разные ревизии. Значения не объединены в новую сумму.
        </p>
      ) : null}
      {facts.map((f) => (
        <article
          key={f.id}
          className="border-waia-divider bg-waia-field rounded-lg border p-3"
          data-fact-id={f.id}
        >
          <p className="text-waia-fg-muted leading-5">{f.label}</p>
          <p className="mt-1 font-semibold break-words tabular-nums">
            {f.value === null
              ? "Недоступно"
              : f.currency
                ? formatAdminMoney(f.value, f.currency)
                : f.value}
          </p>
          {f.coverage ? (
            <p className="text-waia-fg-muted mt-1">
              Охват: {f.coverage.included}/{f.coverage.total ?? "не установлен"}
            </p>
          ) : null}
          {f.reasons.map((r) => (
            <DataState
              key={r}
              state={f.state === "ok" ? "partial" : (f.state as "unavailable")}
              reason={r}
            />
          ))}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <EvidenceTime at={f.observedAt ?? f.generatedAt} />
            <Link
              href={f.href}
              title={`Ревизия: ${f.revision}`}
              className="text-waia-fg inline-flex items-center gap-1 underline underline-offset-4"
            >
              <BookOpen size={12} />
              Источник
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
