"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { MAX_DIARY_BODY_CHARS } from "@/lib/dashboard/diary-body-limits";
import { listDiaryEntriesClient, submitDiaryEntryClient } from "@/lib/dashboard/diary-entries-client";
import type { DiaryMemoryEntryDto } from "@/lib/dashboard/diary-memory-api.types";
import { cn } from "@/lib/utils";

const DIARY_SUBTITLE =
  "This is where your AI-Twin begins remembering your lived experience.";

const DIARY_PLACEHOLDER =
  "What happened today? What did you feel, choose, avoid, desire, or understand?";

const DIARY_SUCCESS_MESSAGE = "Saved. Your Twin has one more piece of lived memory.";

const DIARY_EMPTY_MESSAGE =
  "No diary entries yet. Your first entry becomes the first thread of memory.";

const DIARY_PROMPTS = [
  "What repeated today?",
  "What did I avoid?",
  "What felt true?",
  "Where did I act against myself?",
  "What do I want to remember?",
  "What decision mattered today?",
] as const;

function sortNewestFirst(entries: DiaryMemoryEntryDto[]): DiaryMemoryEntryDto[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function previewBody(text: string, maxChars = 140): string {
  const t = text.trim();
  if (t.length <= maxChars) {
    return t;
  }
  return `${t.slice(0, maxChars)}…`;
}

const dateFormatter =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return dateFormatter ? dateFormatter.format(d) : d.toLocaleString();
  } catch {
    return iso;
  }
}

export type DiaryWorkspaceProps = {
  initialEntries?: DiaryMemoryEntryDto[];
};

export function DiaryWorkspace({ initialEntries = [] }: DiaryWorkspaceProps) {
  const [entries, setEntries] = React.useState<DiaryMemoryEntryDto[]>(() =>
    sortNewestFirst(initialEntries),
  );
  const [draft, setDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [successVisible, setSuccessVisible] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const textareaId = "dashboard-diary-composer-field";
  const charCountId = "dashboard-diary-char-count";

  React.useEffect(() => {
    void (async () => {
      const res = await listDiaryEntriesClient();
      if (res.kind === "ok") {
        setEntries(sortNewestFirst(res.entries));
      }
    })();
  }, []);

  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !submitting;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setErrorMessage(null);
    setSuccessVisible(false);
    setSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    void (async () => {
      const result = await submitDiaryEntryClient({
        body: trimmedDraft,
        idempotencyKey,
      });
      setSubmitting(false);
      if (result.kind === "ok") {
        setDraft("");
        setSuccessVisible(true);
        setEntries((prev) => {
          const without = prev.filter((e) => e.id !== result.body.entry.id);
          return sortNewestFirst([result.body.entry, ...without]);
        });
        return;
      }
      setErrorMessage(result.displayMessage);
    })();
  };

  const appendPrompt = (line: string) => {
    setDraft((prev) => {
      const next = prev.trim().length > 0 ? `${prev.trim()}\n${line}` : line;
      return next.slice(0, MAX_DIARY_BODY_CHARS);
    });
  };

  return (
    <div
      data-testid="dashboard-diary-workspace"
      className="flex min-h-0 max-w-3xl flex-1 flex-col gap-6"
      role="region"
      aria-label="Diary"
    >
      <header className="space-y-2">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">Diary</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{DIARY_SUBTITLE}</p>
      </header>

      {successVisible ? (
        <p
          data-testid="dashboard-diary-success-message"
          className="text-foreground text-sm leading-relaxed"
          role="status"
        >
          {DIARY_SUCCESS_MESSAGE}
        </p>
      ) : null}

      {errorMessage ? (
        <div
          data-testid="dashboard-diary-error-message"
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {errorMessage}
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3"
        aria-label="Write a diary entry for your Twin"
      >
        <div
          data-testid="dashboard-diary-prompts"
          className="flex flex-wrap gap-2"
          aria-label="Reflection prompts"
        >
          {DIARY_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full whitespace-normal py-1.5 text-left text-xs font-normal leading-snug"
              onClick={() => appendPrompt(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={textareaId} className="sr-only">
            Diary entry for your Twin
          </label>
          <textarea
            id={textareaId}
            data-testid="dashboard-diary-textarea"
            value={draft}
            maxLength={MAX_DIARY_BODY_CHARS}
            disabled={submitting}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            rows={5}
            placeholder={DIARY_PLACEHOLDER}
            aria-describedby={charCountId}
            className={cn(
              "min-h-[7rem] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
          <p id={charCountId} className="text-muted-foreground text-xs tabular-nums">
            {draft.length} / {MAX_DIARY_BODY_CHARS}
          </p>
        </div>

        <Button
          type="submit"
          data-testid="dashboard-diary-submit"
          disabled={!canSubmit}
          aria-busy={submitting}
          className="self-start"
        >
          {submitting ? "Saving..." : "Save to Twin memory"}
        </Button>
      </form>

      <section className="min-h-0 flex-1" aria-labelledby="dashboard-diary-recent-heading">
        <h3 id="dashboard-diary-recent-heading" className="mb-3 text-sm font-medium">
          Recent entries
        </h3>
        {entries.length === 0 ? (
          <p
            data-testid="dashboard-diary-empty-state"
            className="text-muted-foreground text-sm leading-relaxed"
          >
            {DIARY_EMPTY_MESSAGE}
          </p>
        ) : (
          <ul
            data-testid="dashboard-diary-entry-list"
            className="flex flex-col gap-3"
          >
            {entries.map((entry) => (
              <li
                key={entry.id}
                data-testid={`dashboard-diary-entry-${entry.id}`}
                className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
              >
                <time dateTime={entry.createdAt} className="block text-muted-foreground text-xs">
                  {formatCreatedAt(entry.createdAt)}
                </time>
                <p className="mt-1 whitespace-pre-wrap text-foreground leading-relaxed">
                  {previewBody(entry.body)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
