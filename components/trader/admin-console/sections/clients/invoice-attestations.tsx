"use client";

import * as React from "react";
import { controlClass } from "@/components/trader/admin-console/primitives/console-ui";

import {
  ISSUANCE_ATTESTATION_KEYS,
  isIssuanceAttestationComplete,
  type IssuanceAttestation,
} from "@/lib/trader/billing/invoice-issuance.types";

const LABELS: Record<(typeof ISSUANCE_ATTESTATION_KEYS)[number], string> = {
  depositsVerified: "Вводы проверены",
  withdrawalsVerified: "Выводы проверены",
  balanceSnapshotsVerified: "Снимки баланса проверены",
  reconciliationVerified: "Сверка проверена",
  exchangeSyncVerified: "Синхронизация с биржей проверена",
  realizedFillFinalityVerified: "Финальность исполнений проверена",
};

const EMPTY: IssuanceAttestation = {
  depositsVerified: false,
  withdrawalsVerified: false,
  balanceSnapshotsVerified: false,
  reconciliationVerified: false,
  exchangeSyncVerified: false,
  realizedFillFinalityVerified: false,
};

export function InvoiceAttestations({
  onApprove,
}: {
  onApprove: (attestations: IssuanceAttestation) => void;
}) {
  const [attestations, setAttestations] = React.useState<IssuanceAttestation>(EMPTY);
  const ready = isIssuanceAttestationComplete(attestations);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onApprove(attestations);
      }}
    >
      {ISSUANCE_ATTESTATION_KEYS.map((key) => (
        <label key={key} className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={attestations[key]}
            onChange={(event) =>
              setAttestations((current) => ({ ...current, [key]: event.target.checked }))
            }
          />
          {LABELS[key]}
        </label>
      ))}
      <button type="submit" className={`${controlClass} mt-2 justify-self-start`} disabled={!ready}>
        Подтвердить выпуск
      </button>
    </form>
  );
}
