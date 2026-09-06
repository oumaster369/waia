"use client";

import * as React from "react";

import { TwinSubscriptionDisclosure } from "@/components/dashboard/twin-subscription-disclosure";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { DashboardTwinDialogueInitialTurn } from "@/lib/dashboard/types";
import { submitTwinDialogueTurnClient } from "@/lib/dashboard/submit-twin-dialogue-turn-client";
import { cn } from "@/lib/utils";

export type TwinDialogueMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  failed?: boolean;
};

/** UI-only opening (DEE-119); not persisted, not sent to the model. Verbatim baseline. */
export const TWIN_OPENING_WELCOME_MESSAGE = [
  "Welcome. This is where your AI-Twin begins to take shape through dialogue.",
  "",
  "You can write naturally, in any language you think in.",
  "",
  "There's no need to explain everything at once. Start with what feels important, or simply tell me how you'd like me to address you.",
].join("\n");

export const TWIN_FIRST_START_FRAMING_COPY = [
  "This is where your AI-Twin begins to take shape — through dialogue, in your own words, at your own pace.",
  "",
  "You can write in the language you think in.",
].join("\n");

export const TWIN_PENDING_REPLY_LABEL = "Your Twin is forming a reply…";

const FORBIDDEN_TWIN_UI_TOKENS = [
  "journey",
  "adventure",
  "discover",
  "soul",
  "awaken",
  "true self",
  "destiny",
  "meant to",
  "calling",
  "energy",
  "story begins",
  "how can i help",
  "let's get started",
  "i'm here to help",
  "your safe space",
  "100+ languages",
  "ai-powered",
] as const;

function assertNoForbiddenTokensInUiCopy(_label: string, raw: string): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  const lower = raw.toLowerCase();
  for (const t of FORBIDDEN_TWIN_UI_TOKENS) {
    if (lower.includes(t)) {
      throw new Error(`Twin UI copy (${_label}) must not contain forbidden token: ${t}`);
    }
  }
}

assertNoForbiddenTokensInUiCopy(
  "welcome",
  TWIN_OPENING_WELCOME_MESSAGE + TWIN_FIRST_START_FRAMING_COPY,
);
assertNoForbiddenTokensInUiCopy("pending", TWIN_PENDING_REPLY_LABEL);

function hydrateMessages(initial: DashboardTwinDialogueInitialTurn[]): TwinDialogueMessage[] {
  return initial.map((t) => ({ id: t.id, role: t.role, text: t.text }));
}

export { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";

export type TwinDialogueWorkspaceProps = {
  /** From server Twin signals: first meaningful exchange already recorded in persistence. */
  hasMeaningfulExchange: boolean;
  /** SSR/RSC seeded turns from `twin_dialogue_turns` (DEE-26). */
  initialTwinDialogueTurns?: DashboardTwinDialogueInitialTurn[];
};

export function TwinDialogueWorkspace({
  hasMeaningfulExchange,
  initialTwinDialogueTurns = [],
}: TwinDialogueWorkspaceProps) {
  const [messages, setMessages] = React.useState<TwinDialogueMessage[]>(() =>
    hydrateMessages(initialTwinDialogueTurns),
  );
  const [draft, setDraft] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [postSignalsMeaningful, setPostSignalsMeaningful] = React.useState(false);
  const [hasRitualStarted, setHasRitualStarted] = React.useState(false);

  const [initialSnapshotEmpty] = React.useState(() => initialTwinDialogueTurns.length === 0);

  const listRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const meaningfulForWorkspace = hasMeaningfulExchange || postSignalsMeaningful;

  const showFramingAndCta = !meaningfulForWorkspace && initialSnapshotEmpty && !hasRitualStarted;
  const showWelcomeBubble = hasRitualStarted && !meaningfulForWorkspace && initialSnapshotEmpty;

  const showActiveHistoryHint = meaningfulForWorkspace && messages.length === 0;

  /** Consent: user must tap Start before first send when there is no persisted dialogue yet. */
  const mustCompleteFirstStart =
    !meaningfulForWorkspace && initialSnapshotEmpty && !hasRitualStarted;

  const textareaDescribedby = [
    showFramingAndCta || showWelcomeBubble ? "dashboard-twin-invitation-desc" : null,
    submitError ? "dashboard-twin-dialogue-error-desc" : null,
  ]
    .filter(Boolean)
    .join(" ");

  React.useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages.length, isSubmitting, showWelcomeBubble]);

  const submitText = React.useCallback((text: string, idempotencyKey: string) => {
    setSubmitError(null);
    setIsSubmitting(true);

    void (async () => {
      const result = await submitTwinDialogueTurnClient({ message: text, idempotencyKey });
      setIsSubmitting(false);
      if (result.kind === "ok") {
        const assistantTurn = result.body.assistantTurn;
        const assistantId = assistantTurn?.id ?? crypto.randomUUID();
        const assistantText = assistantTurn?.content ?? result.body.assistantPlaceholder;
        setPostSignalsMeaningful((prev) => prev || result.body.twinSignals.hasMeaningfulExchange);
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === idempotencyKey && m.role === "user"
              ? { ...m, id: result.body.userTurn.id, pending: false, failed: false }
              : m,
          );
          return [
            ...next,
            {
              id: assistantId,
              role: "assistant" as const,
              text: assistantText,
            },
          ];
        });
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === idempotencyKey && m.role === "user" ? { ...m, pending: false, failed: true } : m,
        ),
      );
      setSubmitError(result.displayMessage);
    })();
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSubmitting) {
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: idempotencyKey, role: "user", text, pending: true }]);
    setDraft("");
    submitText(text, idempotencyKey);
  };

  const handleRetry = (msg: TwinDialogueMessage) => {
    if (!msg.failed || isSubmitting) {
      return;
    }
    const idempotencyKey = msg.id;
    setMessages((prev) =>
      prev.map((m) => (m.id === idempotencyKey ? { ...m, pending: true, failed: false } : m)),
    );
    submitText(msg.text, idempotencyKey);
  };

  const handleStartRitual = () => {
    setHasRitualStarted(true);
    queueMicrotask(() => {
      textareaRef.current?.focus();
    });
  };

  const textareaId = "dashboard-twin-composer-field";

  return (
    <div
      data-testid="dashboard-twin-dialogue-workspace"
      className="flex min-h-0 flex-1 flex-col gap-3"
      role="region"
      aria-label="Twin dialogue"
    >
      {showFramingAndCta && (
        <WaiaSurface
          variant="invitation"
          data-testid="dashboard-twin-invitation-placeholder"
          id="dashboard-twin-invitation-desc"
          className="text-muted-foreground flex flex-col gap-3 p-4 text-sm leading-relaxed"
        >
          <p className="whitespace-pre-line">{TWIN_FIRST_START_FRAMING_COPY}</p>
          <Button
            type="button"
            data-testid="dashboard-twin-start-cta"
            className="self-start"
            onClick={handleStartRitual}
          >
            Start creating your AI-Twin
          </Button>
        </WaiaSurface>
      )}

      {showActiveHistoryHint && (
        <p className="text-muted-foreground text-center text-xs">
          Earlier saved turns load again when you return; new messages persist as you send.
        </p>
      )}

      {submitError && (
        <div
          id="dashboard-twin-dialogue-error-desc"
          data-testid="dashboard-twin-dialogue-error"
          role="alert"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {submitError}
        </div>
      )}

      <WaiaSurface
        ref={listRef}
        variant="raised"
        data-testid="dashboard-twin-message-list"
        role="log"
        aria-relevant="additions"
        aria-live="polite"
        className="flex max-h-[min(50vh,24rem)] min-h-[6rem] flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {showWelcomeBubble && (
          <article
            data-welcome="true"
            data-testid="dashboard-twin-welcome-bubble"
            id={showFramingAndCta ? undefined : "dashboard-twin-invitation-desc"}
            role="article"
            data-role="assistant"
            aria-label="Twin"
            className="bg-card text-card-foreground ring-border self-start rounded-lg px-3 py-2 text-sm whitespace-pre-line ring-1"
          >
            {TWIN_OPENING_WELCOME_MESSAGE}
          </article>
        )}
        {messages.map((msg, idx) => (
          <article
            key={msg.id}
            role="article"
            data-role={msg.role}
            aria-label={msg.role === "user" ? "You" : "Twin"}
            data-testid={`dashboard-twin-msg-${msg.role}-${idx}`}
            data-pending={msg.pending ? "true" : undefined}
            data-failed={msg.failed ? "true" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              msg.role === "user"
                ? cn(
                    "bg-primary text-primary-foreground self-end",
                    msg.failed && "ring-destructive/60 opacity-90 ring-2",
                  )
                : "bg-card text-card-foreground ring-border self-start ring-1",
            )}
          >
            <div className="whitespace-pre-wrap">{msg.text}</div>
            {msg.failed && (
              <div className="text-primary-foreground/90 mt-2 flex flex-wrap items-center gap-2 border-t border-current/20 pt-2 text-xs">
                <span>Not sent</span>
                <button
                  type="button"
                  data-testid={`dashboard-twin-retry-${msg.id}`}
                  className="underline underline-offset-2 hover:opacity-90"
                  onClick={() => {
                    handleRetry(msg);
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </article>
        ))}
        {isSubmitting && (
          <p
            data-testid="dashboard-twin-pending-reply"
            aria-live="polite"
            className="text-muted-foreground text-xs"
          >
            {TWIN_PENDING_REPLY_LABEL}
          </p>
        )}
      </WaiaSurface>

      <form
        onSubmit={handleSubmit}
        aria-label="Send a message in Twin dialogue"
        className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label htmlFor={textareaId} className="sr-only">
          Message to Twin
        </label>
        <Textarea
          ref={textareaRef}
          id={textareaId}
          data-testid="dashboard-twin-message-input"
          value={draft}
          disabled={isSubmitting || mustCompleteFirstStart}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          rows={2}
          placeholder="Write to your Twin..."
          aria-describedby={textareaDescribedby.length > 0 ? textareaDescribedby : undefined}
          className="bg-background dark:bg-background min-h-[2.75rem] w-full shrink px-3 text-sm shadow-xs"
        />
        <Button
          type="submit"
          data-testid="dashboard-twin-send"
          aria-busy={isSubmitting}
          disabled={isSubmitting || draft.trim().length === 0 || mustCompleteFirstStart}
          className="sm:w-auto"
        >
          {isSubmitting ? "Sending" : "Send"}
        </Button>
      </form>
      <TwinSubscriptionDisclosure />
    </div>
  );
}
