import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { OrdersPanel } from "@/components/trader/admin-console/sections/orders/orders-panel";
import { EmergencyStopDialog } from "@/components/trader/admin-console/primitives/emergency-stop-dialog";
import {
  emergencyEffect,
  emergencyTripBody,
} from "@/components/trader/admin-console/primitives/emergency-stop";
import { killSwitchEnforcementModeEnum, killSwitchTypeEnum } from "@/db/schema";

describe("admin console emergency stop", () => {
  it("uses switch types and enforcement modes the kill switch already stores", () => {
    for (const type of ["PAUSE", "CLOSE_ONLY", "EMERGENCY_STOP"]) {
      expect(killSwitchTypeEnum).toContain(type);
    }
    expect([...killSwitchEnforcementModeEnum]).toEqual(["STOP_ACCOUNT", "CLOSE_ONLY", "REJECT"]);
  });

  it("does not build a trip until the reason is confirmed, and says the command does not close positions", () => {
    const incomplete = emergencyTripBody({
      organizationId: "org-1",
      switchType: "EMERGENCY_STOP",
      enforcementMode: "STOP_ACCOUNT",
      expectedStateVersion: 3,
      reason: "биржа не отвечает",
      confirmed: false,
    });
    expect(incomplete.ok).toBe(false);
    const ready = emergencyTripBody({
      organizationId: "org-1",
      switchType: "EMERGENCY_STOP",
      enforcementMode: "STOP_ACCOUNT",
      expectedStateVersion: 3,
      reason: "биржа не отвечает",
      confirmed: true,
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.body.command).toBe("trip");
    expect(emergencyEffect("EMERGENCY_STOP", "STOP_ACCOUNT")).toContain(
      "Закрытие позиций эта команда не выполняет.",
    );
  });

  it("walks scope, effect, and confirmation, then waits for a fresh read", () => {
    const onSubmit = vi.fn();
    render(
      <EmergencyStopDialog
        open
        expectedStateVersion={4}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Идентификатор организации"), {
      target: { value: "org-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: RU.emergency.next }));
    expect(screen.getByText(/Закрытие позиций эта команда не выполняет/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: RU.emergency.next }));
    fireEvent.change(screen.getByLabelText(RU.emergency.reason), {
      target: { value: "биржа не отвечает" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: RU.emergency.confirm }));
    fireEvent.click(screen.getByRole("button", { name: RU.emergency.submit }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "trip",
        organization_id: "org-1",
        expected_state_version: 4,
      }),
    );
    expect(screen.getByText(RU.emergency.pending)).toBeInTheDocument();
  });

  it("does not send a trip when the kill-switch version was not read", () => {
    render(
      <EmergencyStopDialog
        open
        expectedStateVersion={null}
        onClose={() => undefined}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Идентификатор организации"), {
      target: { value: "org-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: RU.emergency.next }));
    fireEvent.click(screen.getByRole("button", { name: RU.emergency.next }));
    expect(screen.getByRole("button", { name: RU.emergency.submit })).toBeDisabled();
    expect(screen.getByText(RU.emergency.versionMissing)).toBeInTheDocument();
  });

  it("acks the first painted order version once", () => {
    const row = {
      id: "order-1",
      symbol: "btcusdt",
      state: "OPEN",
      label: "Открыт",
      entityVersion: "7",
    };
    const view = render(<OrdersPanel rows={[row]} />);
    expect(view.container.querySelector("[data-render-ack]")).toHaveAttribute(
      "data-render-ack",
      "1",
    );
    view.rerender(<OrdersPanel rows={[row]} />);
    expect(view.container.querySelector("[data-render-ack]")).toHaveAttribute(
      "data-render-ack",
      "1",
    );
  });
});
