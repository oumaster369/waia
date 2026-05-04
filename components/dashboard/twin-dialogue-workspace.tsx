"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
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
  const listRef = React.useRef<HTMLDivElement>(null);

  const showInvitation = !hasMeaningfulExchange && messages.length === 0;
  const showActiveHistoryHint = hasMeaningfulExchange && messages.length === 0;

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
    if (!text) {
      return;
    }
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: assistantId, role: "assistant", text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE },
    ]);
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
          Your saved turns will appear here once dialogue persistence is wired.
        </p>
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
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          rows={2}
          placeholder="Write to your Twin..."
          aria-describedby={showInvitation ? "dashboard-twin-invitation-desc" : undefined}
          className={cn(
            "min-h-[2.75rem] w-full shrink rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        />
        <Button type="submit" data-testid="dashboard-twin-send" className="sm:w-auto">
          Send
        </Button>
      </form>
    </div>
  );
}
