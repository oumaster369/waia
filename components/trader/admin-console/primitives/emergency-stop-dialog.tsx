"use client";

import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import {
  EMERGENCY_ENFORCEMENT_MODES,
  EMERGENCY_SWITCH_TYPES,
  emergencyEffect,
  emergencyTripBody,
} from "@/components/trader/admin-console/primitives/emergency-stop";

export function EmergencyStopDialog({
  open,
  onClose,
  expectedStateVersion,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  expectedStateVersion: number | null;
  onSubmit: (body: Extract<ReturnType<typeof emergencyTripBody>, { ok: true }>["body"]) => void;
}) {
  const [step, setStep] = React.useState<1 | 2 | 3 | "pending">(1);
  const [scope, setScope] = React.useState<"organization" | "account">("organization");
  const [organizationId, setOrganizationId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [switchType, setSwitchType] =
    React.useState<(typeof EMERGENCY_SWITCH_TYPES)[number]>("PAUSE");
  const [enforcementMode, setEnforcementMode] =
    React.useState<(typeof EMERGENCY_ENFORCEMENT_MODES)[number]>("CLOSE_ONLY");
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);

  if (!open) return null;
  const trip = emergencyTripBody({
    organizationId,
    accountId: scope === "account" ? accountId : undefined,
    switchType,
    enforcementMode,
    expectedStateVersion: expectedStateVersion ?? 0,
    reason,
    confirmed,
  });
  const canSubmit = expectedStateVersion !== null && trip.ok;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="emergency-stop-title">
      <h2 id="emergency-stop-title">{RU.emergency.title}</h2>
      {step === "pending" ? <p>{RU.emergency.pending}</p> : null}
      {step === 1 ? (
        <fieldset>
          <legend>{RU.emergency.scope}</legend>
          <label>
            <input
              type="radio"
              name="emergency-scope"
              checked={scope === "organization"}
              onChange={() => setScope("organization")}
            />
            {RU.emergency.organization}
          </label>
          <label>
            <input
              type="radio"
              name="emergency-scope"
              checked={scope === "account"}
              onChange={() => setScope("account")}
            />
            {RU.emergency.account}
          </label>
          <label>
            {RU.emergency.organization}
            <input
              aria-label="Идентификатор организации"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            />
          </label>
          {scope === "account" ? (
            <label>
              {RU.emergency.account}
              <input
                aria-label="Идентификатор счёта"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              />
            </label>
          ) : null}
          <button type="button" onClick={() => setStep(2)}>
            {RU.emergency.next}
          </button>
        </fieldset>
      ) : null}
      {step === 2 ? (
        <fieldset>
          <legend>{RU.emergency.type}</legend>
          <select
            aria-label={RU.emergency.type}
            value={switchType}
            onChange={(event) =>
              setSwitchType(event.target.value as (typeof EMERGENCY_SWITCH_TYPES)[number])
            }
          >
            {EMERGENCY_SWITCH_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            aria-label={RU.emergency.enforcement}
            value={enforcementMode}
            onChange={(event) =>
              setEnforcementMode(event.target.value as (typeof EMERGENCY_ENFORCEMENT_MODES)[number])
            }
          >
            {EMERGENCY_ENFORCEMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <p>{emergencyEffect(switchType, enforcementMode)}</p>
          <button type="button" onClick={() => setStep(3)}>
            {RU.emergency.next}
          </button>
        </fieldset>
      ) : null}
      {step === 3 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || !trip.ok) return;
            onSubmit(trip.body);
            setStep("pending");
          }}
        >
          {expectedStateVersion === null ? <p>{RU.emergency.versionMissing}</p> : null}
          <label>
            {RU.emergency.reason}
            <textarea
              aria-label={RU.emergency.reason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {RU.emergency.confirm}
          </label>
          <button type="submit" disabled={!canSubmit}>
            {RU.emergency.submit}
          </button>
        </form>
      ) : null}
      <button type="button" onClick={onClose}>
        {RU.emergency.close}
      </button>
    </div>
  );
}
