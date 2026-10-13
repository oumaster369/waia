"use client";
import * as React from "react";
import { Check, CircleStop } from "lucide-react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import {
  ConsoleDialog,
  ConsoleLoading,
  controlClass,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import type { ConsoleCatalogue } from "@/components/trader/admin-console/shell/context-controls";

type Control = {
  target: {
    scope: "platform" | "organization";
    organization_id?: string;
    switch_type: "PAUSE" | "CLOSE_ONLY" | "EMERGENCY_STOP";
  };
  expectedStateVersion: number;
  state: string;
  enforcementMode: string | null;
  updatedAt: string | null;
};
const EFFECTS = {
  PAUSE:
    "Pause new entries. The existing runtime records PAUSE with CLOSE_ONLY restrictions: only risk-reducing actions approved by Risk are allowed. Resumption is a separate procedure.",
  CLOSE_ONLY:
    "Risk reduction only. A separate CLOSE_ONLY switch is recorded; new entries are prohibited. Risk still determines admission for every reduction.",
  EMERGENCY_STOP:
    "Stop execution in the selected scope. EMERGENCY_STOP is recorded with STOP_ACCOUNT mode. Lifting the restriction requires a separate recovery procedure.",
} as const;
export function EmergencyWorkflow({
  open,
  onClose,
  catalogue,
}: {
  open: boolean;
  onClose: () => void;
  catalogue: ConsoleCatalogue | null;
}) {
  return open ? <EmergencyBody onClose={onClose} catalogue={catalogue} /> : null;
}
function EmergencyBody({
  onClose,
  catalogue,
}: {
  onClose: () => void;
  catalogue: ConsoleCatalogue | null;
}) {
  const context = useAdminReadContext();
  const initial = new URLSearchParams(context.query);
  const [scope, setScope] = React.useState<"platform" | "organization" | "account">(
    initial.has("exchange_account_id")
      ? "account"
      : initial.has("organization_id")
        ? "organization"
        : "platform",
  );
  const [organizationId, setOrganizationId] = React.useState(initial.get("organization_id") ?? "");
  const [type, setType] = React.useState<Control["target"]["switch_type"]>("PAUSE");
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<"confirmed" | "uncertain" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmedState, setConfirmedState] = React.useState<Control | null>(null);
  const inFlight = React.useRef(false);
  const target =
    scope === "account"
      ? null
      : {
          scope,
          ...(scope === "organization" ? { organization_id: organizationId } : {}),
          switch_type: type,
        };
  const targetQuery = target ? new URLSearchParams(target).toString() : "";
  const path = `/api/trader/admin/console/kill-switch?${targetQuery}`;
  const read = useAdminRead<Control>(step > 1 && target ? path : null, {
    context: false,
    intervalMs: 0,
  });
  const snapshot =
    read.envelope?.data && typeof read.envelope.data.expectedStateVersion === "number"
      ? read.envelope
      : null;
  const identity = `${context.query}:${targetQuery}:${snapshot?.revision ?? "unread"}`;
  const [attestedIdentity, setAttestedIdentity] = React.useState<string | null>(null);
  const scopeName =
    scope === "platform"
      ? "Entire fleet, all organizations"
      : scope === "account"
        ? "Individual account: unsupported by runtime"
        : catalogue?.clients.find((item) => item.id === organizationId)?.name || organizationId;
  const canSubmit =
    !pending &&
    !read.refreshing &&
    !read.reason &&
    !result &&
    confirmed &&
    attestedIdentity === identity &&
    reason.trim().length > 0 &&
    snapshot &&
    snapshot.data.state !== "ACTIVE";
  const submit = async () => {
    if (!canSubmit || !snapshot || !target || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/trader/admin/console/kill-switch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          target,
          command: "trip",
          expectedRevision: snapshot.revision,
          expectedStateVersion: snapshot.data.expectedStateVersion,
          reason: reason.trim(),
          confirmed: true,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const body = await response.json();
      if (response.status === 409) {
        setConfirmed(false);
        setAttestedIdentity(null);
        setStep(2);
        read.reload();
        setError("State changed. Check fresh data and confirm the command again.");
        return;
      }
      if (!response.ok || !body.data) throw new Error(body.error?.code ?? "COMMAND_NOT_CONFIRMED");
      // An acknowledgement is not enough: read the state back before showing success.
      const verify = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (verify.status === 401 || verify.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const fresh = await verify.json();
      if (!verify.ok || fresh.revision !== body.revision || fresh.data?.state !== "ACTIVE")
        throw new Error("READ_BACK_NOT_CONFIRMED");
      setConfirmedState(fresh.data);
      setResult("confirmed");
    } catch {
      setResult("uncertain");
      setError(
        "Command confirmation was not received. The command may have applied. Resubmission is blocked; check the current switch state.",
      );
    } finally {
      window.clearTimeout(timeout);
      setPending(false);
      inFlight.current = false;
    }
  };
  return (
    <ConsoleDialog
      open
      onClose={onClose}
      dismissible={!pending}
      title="Emergency stop"
      description="Scope, exact effect and manual confirmation. The command is recorded in the audit log."
    >
      <ol aria-label="Confirmation steps" className="mb-6 flex gap-2 text-xs">
        {["Scope", "Effect", "Confirmation"].map((label, index) => (
          <li
            key={label}
            className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 ${step === index + 1 ? "bg-waia-elevated text-waia-fg" : "text-waia-fg-muted"}`}
          >
            <span className="tabular-nums">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error ? (
        <p
          role="alert"
          className="border-waia-warning/30 bg-waia-warning/10 text-waia-warning mb-4 rounded-lg border p-3 text-sm leading-6"
        >
          {error}
        </p>
      ) : null}
      {result === "confirmed" ? (
        <div role="status" className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Check size={20} className="text-waia-success" />
            State confirmed by reread
          </h3>
          <p className="text-sm">
            {scopeName} · {type} · {confirmedState?.enforcementMode}
          </p>
          <p className="text-xs">
            <EvidenceTime at={confirmedState?.updatedAt} />
          </p>
        </div>
      ) : result === "uncertain" ? (
        <p className="text-waia-fg-muted text-sm leading-6">
          Open System → Permissions and limits to check the current state. There is no automatic retry.
        </p>
      ) : (
        <>
          {step === 1 ? (
            <fieldset className="grid gap-4">
              <legend className="mb-4 text-sm font-semibold">Where the command applies</legend>
              <label className="grid gap-2 text-sm">
                Scope
                <select
                  aria-label="Stop scope"
                  className={controlClass}
                  value={scope}
                  onChange={(event) => setScope(event.target.value as typeof scope)}
                >
                  <option value="platform">Entire fleet</option>
                  <option value="organization">Entire client</option>
                  <option value="account" disabled>
                    Individual account, unsupported
                  </option>
                </select>
              </label>
              {scope === "organization" ? (
                <label className="grid gap-2 text-sm">
                  Client
                  <select
                    aria-label="Client to stop"
                    className={controlClass}
                    value={organizationId}
                    onChange={(event) => setOrganizationId(event.target.value)}
                  >
                    <option value="">Select a client</option>
                    {organizationId &&
                    !catalogue?.clients.some((item) => item.id === organizationId) ? (
                      <option value={organizationId}>{organizationId}</option>
                    ) : null}
                    {catalogue?.clients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name || item.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-waia-fg-muted text-sm leading-6">
                Individual account, strategy and instrument scope are not yet supported by this runtime command. Selecting a client stops the entire organization scope.
              </p>
              <button
                className={`${controlClass} justify-self-end`}
                type="button"
                disabled={scope === "account" || (scope === "organization" && !organizationId)}
                onClick={() => setStep(2)}
              >
                Next
              </button>
            </fieldset>
          ) : null}
          {step === 2 ? (
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm">
                Command type
                <select
                  aria-label="Command type"
                  className={controlClass}
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value as typeof type);
                    setConfirmed(false);
                  }}
                >
                  <option value="PAUSE">PAUSE · Pause</option>
                  <option value="CLOSE_ONLY">CLOSE_ONLY · Risk reduction only</option>
                  <option value="EMERGENCY_STOP">EMERGENCY_STOP · Stop execution</option>
                </select>
              </label>
              <p className="text-sm font-semibold">{scopeName}</p>
              <p className="border-waia-warning/25 bg-waia-warning/5 rounded-lg border p-4 text-sm leading-6">
                {EFFECTS[type]}
              </p>
              <p className="text-waia-fg-muted text-sm leading-6">
                The command does not place or cancel orders or close positions. A saved kill-fold record does not prove actual cancellation at the exchange.
              </p>
              {read.loading ? (
                <ConsoleLoading label="Reading switch state…" />
              ) : read.reason ? (
                <DataState state="unavailable" reason={read.reason} />
              ) : snapshot ? (
                <p className="text-waia-fg-muted text-xs">
                  State:{" "}
                  {snapshot.data.state === "NOT_CREATED"
                    ? "switch not yet created"
                    : snapshot.data.state}{" "}
                  · version {snapshot.data.expectedStateVersion}
                </p>
              ) : null}
              {snapshot?.data.state === "ACTIVE" ? (
                <p className="text-waia-warning text-sm">
                  The switch is already active. Another trip command is unavailable.
                </p>
              ) : null}
              <div className="flex justify-between">
                <button className={controlClass} type="button" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  className={controlClass}
                  type="button"
                  disabled={
                    !snapshot ||
                    read.refreshing ||
                    Boolean(read.reason) ||
                    snapshot.data.state === "ACTIVE"
                  }
                  onClick={() => setStep(3)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="grid gap-4"
            >
              <p className="text-sm font-semibold">
                {scopeName} · {type}
              </p>
              <p className="text-waia-fg-muted text-sm leading-6">{EFFECTS[type]}</p>
              <label className="grid gap-2 text-sm">
                Reason
                <textarea
                  aria-label="Reason"
                  required
                  maxLength={2000}
                  disabled={pending}
                  className={`${controlClass} h-24 py-2`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  disabled={pending}
                  checked={confirmed && attestedIdentity === identity}
                  onChange={(event) => {
                    setConfirmed(event.target.checked);
                    setAttestedIdentity(event.target.checked ? identity : null);
                  }}
                />
                I confirm the command scope and effect
              </label>
              <div className="flex justify-between gap-3">
                <button
                  className={controlClass}
                  disabled={pending}
                  type="button"
                  onClick={() => {
                    setConfirmed(false);
                    setStep(2);
                    read.reload();
                  }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="border-waia-danger/50 bg-waia-danger/20 text-waia-danger-fg inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm disabled:opacity-40"
                >
                  <CircleStop size={16} />
                  {pending ? "Waiting for reread…" : "Submit command"}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </ConsoleDialog>
  );
}
