"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { treasuryJson } from "@/lib/treasury-admin/api";
import { formatAtomicToHumanDecimal } from "@/lib/treasury-admin/parse-human-amount";

type AssistantResponse =
  | { mode: "unsupported"; summary: string }
  | {
      mode: "report";
      summary: string;
      report: {
        kind: "overview" | "budget" | "transactions";
        title: string;
        generatedAt: string;
        data: Record<string, unknown>;
      };
    }
  | {
      mode: "write_preview";
      summary: string;
      intent: string;
      fields: Record<string, string | null>;
      confirmationAvailable: boolean;
      confirmationToken: string | null;
      notice: string;
    }
  | {
      mode: "write_result";
      intent: string;
      entityType: string;
      entity: Record<string, unknown>;
      notice: string;
    };

function label(value: string): string {
  return value
    .replace(/Micros$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function scalar(field: string, value: string | number | boolean): string {
  if (typeof value === "string" && /Micros$/.test(field) && /^-?\d+$/.test(value)) {
    return formatAtomicToHumanDecimal(value, 6);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function ReportData({
  value,
  depth = 0,
  field = "",
}: {
  value: unknown;
  depth?: number;
  field?: string;
}) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    return (
      <div className="space-y-2">
        {value.slice(0, 20).map((item, index) => (
          <div key={index} className="rounded border p-2">
            <ReportData value={item} depth={depth + 1} field={field} />
          </div>
        ))}
        {value.length > 20 ? (
          <p className="text-muted-foreground">Showing 20 of {value.length}.</p>
        ) : null}
      </div>
    );
  }
  if (typeof value === "object") {
    return (
      <dl className={depth === 0 ? "space-y-3" : "space-y-1.5"}>
        {Object.entries(value as Record<string, unknown>).map(([field, nested]) => (
          <div key={field} className="grid grid-cols-[minmax(7rem,0.7fr)_1fr] gap-2">
            <dt className="text-muted-foreground text-xs">{label(field)}</dt>
            <dd className="min-w-0 text-xs break-words">
              <ReportData value={nested} depth={depth + 1} field={field} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{scalar(field, value)}</span>;
  }
  return <span>{String(value)}</span>;
}

export function FinanceAssistant() {
  const { organizationId } = useFinanceOrg();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResponse | null>(null);

  async function submit() {
    if (!organizationId || !message.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    const response = await treasuryJson<AssistantResponse>(
      "/api/admin/treasury/assistant/plan",
      "POST",
      { organization_id: organizationId, message: message.trim() },
    );
    setPending(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
  }

  async function confirmWrite(token: string) {
    if (!organizationId) return;
    setPending(true);
    setError(null);
    const response = await treasuryJson<AssistantResponse>(
      "/api/admin/treasury/assistant/execute",
      "POST",
      { organization_id: organizationId, confirmation_token: token },
    );
    setPending(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2">
      {open ? (
        <section
          aria-label="Finance Assistant"
          className="bg-background w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-4 shadow-xl"
          data-testid="finance-assistant"
        >
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Finance Assistant</h2>
              <p className="text-muted-foreground text-xs">
                Ask for a report or preview one new Finance record. The assistant cannot move money,
                verify transactions, publish data, or access AI‑TRADER.
              </p>
            </div>
            <button
              type="button"
              className="hover:bg-muted rounded p-1"
              aria-label="Close Finance Assistant"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </header>

          <label className="text-sm font-medium" htmlFor="finance-assistant-message">
            Request
          </label>
          <textarea
            id="finance-assistant-message"
            value={message}
            maxLength={4000}
            rows={4}
            placeholder="Show this month’s budget, or create a preview for a new counterparty…"
            onChange={(event) => setMessage(event.target.value)}
            className="mt-1 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            className="mt-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            disabled={pending || !organizationId || !message.trim()}
            onClick={() => void submit()}
          >
            {pending ? "Working…" : "Ask Finance"}
          </button>

          {!organizationId ? (
            <p className="mt-3 text-sm text-amber-700">Select an organization first.</p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
          {result ? (
            <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-lg border p-3">
              {"summary" in result ? <p className="text-sm">{result.summary}</p> : null}
              {result.mode === "report" ? (
                <div className="mt-3">
                  <h3 className="mb-2 text-sm font-medium">{result.report.title}</h3>
                  <ReportData value={result.report.data} />
                </div>
              ) : null}
              {result.mode === "write_preview" ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase">Preview only</p>
                    <ReportData
                      value={Object.fromEntries(
                        Object.entries(result.fields).filter(([, value]) => value !== null),
                      )}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">{result.notice}</p>
                  {result.confirmationAvailable && result.confirmationToken ? (
                    <button
                      type="button"
                      className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void confirmWrite(result.confirmationToken!)}
                    >
                      {pending ? "Creating…" : "Confirm and create"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {result.mode === "write_result" ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-medium">Created {label(result.entityType)}</p>
                  <ReportData value={result.entity} />
                  <p className="text-muted-foreground text-xs">{result.notice}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        className="bg-foreground text-background flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-lg"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <MessageCircle className="size-4" />
        Ask Finance
      </button>
    </div>
  );
}
