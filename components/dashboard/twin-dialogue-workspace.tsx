"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { submitTwinDialogueTurnClient } from "@/lib/dashboard/submit-twin-dialogue-turn-client";
import { cn } from "@/lib/utils";

export type TwinDialogueMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export {
  TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
} from "@/lib/dashboard/twin-dialogue-stub";

export type TwinDialogueWorkspaceProps = {
  /** From server Twin signals: first meaningful exchange already recorded in persistence. */
  hasMeaningfulExchange: boolean;
};

export function TwinDialogueWorkspace({ hasMeaningfulExchange }: TwinDialogueWorkspaceProps) {
  const [messages, setMessages] = React.useState<TwinDialogueMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [postSignalsMeaningful, setPostSignalsMeaningful] = React.useState(false);

  const listRef = React.useRef<HTMLDivElement>(null);

  const meaningfulForWorkspace = hasMeaningfulExchange || postSignalsMeaningful;

  const showInvitation = !meaningfulForWorkspace && messages.length === 0;
  const showActiveHistoryHint = meaningfulForWorkspace && messages.length === 0;

  const textareaDescribedby = [
    showInvitation ? "dashboard-twin-invitation-desc" : null,
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
  }, [messages.length]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSubmitting) {
      return;
    }
    setSubmitError(null);
    setIsSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    void (async () => {
      const result = await submitTwinDialogueTurnClient({ message: text, idempotencyKey });
      setIsSubmitting(false);
      if (result.kind === "ok") {
        const assistantLocalId = crypto.randomUUID();
        setDraft("");
        setPostSignalsMeaningful((prev) => prev || result.body.twinSignals.hasMeaningfulExchange);
        setMessages((prev) => [
          ...prev,
          {
            id: result.body.userTurn.id,
            role: "user",
            text: result.body.userTurn.content,
          },
          {
            id: assistantLocalId,
            role: "assistant",
            text: result.body.assistantPlaceholder,
          },
        ]);
        return;
      }
      setSubmitError(result.displayMessage);
    })();
  };

  const textareaId = "dashboard-twin-composer-field";

  return (
    <div
      data-testid="dashboard-twin-dialogue-workspace"
      className="flex min-h-0 flex-1 flex-col gap-3"
      role="region"
      aria-label="Twin dialogue"
    >
      {showInvitation && (
        <div
          data-testid="dashboard-twin-invitation-placeholder"
          id="dashboard-twin-invitation-desc"
          className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-muted-foreground text-sm leading-relaxed"
        >
          Welcome to Twin mode. Chat below to build your AI-Twin—the flow stays conversational, not a
          questionnaire. Twin replies appear as stubs until the dialogue service connects.
        </div>
      )}

      {showActiveHistoryHint && (
        <p className="text-center text-muted-foreground text-xs">
          Earlier saved turns load again when you return; new messages persist as you send.
        </p>
      )}

      {submitError && (
        <div
          id="dashboard-twin-dialogue-error-desc"
          data-testid="dashboard-twin-dialogue-error"
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {submitError}
        </div>
      )}

      <div
        ref={listRef}
        data-testid="dashboard-twin-message-list"
        role="log"
        aria-relevant="additions"
        aria-live="polite"
        className="flex max-h-[min(50vh,24rem)] min-h-[6rem] flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-muted/10 p-3"
      >
        {messages.map((msg, idx) => (
          <article
            key={msg.id}
            role="article"
            data-role={msg.role}
            aria-label={msg.role === "user" ? "You" : "Twin"}
            data-testid={`dashboard-twin-msg-${msg.role}-${idx}`}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              msg.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-card text-card-foreground ring-1 ring-border",
            )}
          >
            {msg.text}
          </article>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        aria-label="Send a message in Twin dialogue"
        className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label htmlFor={textareaId} className="sr-only">
          Message to Twin
        </label>
        <textarea
          id={textareaId}
          data-testid="dashboard-twin-message-input"
          value={draft}
          disabled={isSubmitting}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          rows={2}
          placeholder="Write to your Twin..."
          aria-describedby={textareaDescribedby.length > 0 ? textareaDescribedby : undefined}
          className={cn(
            "min-h-[2.75rem] w-full shrink rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        <Button
          type="submit"
          data-testid="dashboard-twin-send"
          aria-busy={isSubmitting}
          disabled={isSubmitting || draft.trim().length === 0}
          className="sm:w-auto"
        >
          {isSubmitting ? "Sending..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
