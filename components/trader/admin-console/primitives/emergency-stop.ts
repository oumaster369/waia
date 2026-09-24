export const EMERGENCY_SWITCH_TYPES = ["PAUSE", "CLOSE_ONLY", "EMERGENCY_STOP"] as const;
export const EMERGENCY_ENFORCEMENT_MODES = ["REJECT", "CLOSE_ONLY", "STOP_ACCOUNT"] as const;

const ALLOWED_TYPES = new Set<string>(EMERGENCY_SWITCH_TYPES);

export function emergencyEffect(switchType: string, enforcementMode: string): string {
  const stored =
    enforcementMode === "STOP_ACCOUNT"
      ? "STOP_ACCOUNT"
      : "CLOSE_ONLY (команда trip не сохраняет REJECT)";
  return [
    "Запрет новых входов, отмена ордеров и закрытие позиций — разные операции.",
    `Команда trip с типом ${switchType} записывает kill switch и сохраняет режим ${stored}.`,
    "Kill fold при trip отмечает отмену ожидающих входов.",
    "Закрытие позиций эта команда не выполняет.",
  ].join(" ");
}

export function emergencyTripBody(input: {
  organizationId: string;
  accountId?: string;
  switchType: string;
  enforcementMode: string;
  expectedStateVersion: number;
  reason: string;
  confirmed: boolean;
}):
  | {
      ok: true;
      body: {
        command: "trip";
        organization_id: string;
        account_id?: string;
        switch_type: string;
        enforcement_mode: string;
        origin: "manual";
        expected_state_version: number;
        reason: string;
      };
    }
  | { ok: false; reason: "INCOMPLETE" | "UNKNOWN_SWITCH" } {
  if (
    !input.confirmed ||
    input.reason.trim().length === 0 ||
    input.organizationId.trim().length === 0 ||
    !ALLOWED_TYPES.has(input.switchType) ||
    !(EMERGENCY_ENFORCEMENT_MODES as readonly string[]).includes(input.enforcementMode)
  ) {
    return {
      ok: false,
      reason: ALLOWED_TYPES.has(input.switchType) ? "INCOMPLETE" : "UNKNOWN_SWITCH",
    };
  }
  return {
    ok: true,
    body: {
      command: "trip",
      organization_id: input.organizationId,
      ...(input.accountId ? { account_id: input.accountId } : {}),
      switch_type: input.switchType,
      enforcement_mode: input.enforcementMode,
      origin: "manual",
      expected_state_version: input.expectedStateVersion,
      reason: input.reason.trim(),
    },
  };
}
