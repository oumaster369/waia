"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  impact: string;
  confirmLabel: string;
  reasonRequired?: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  impact,
  confirmLabel,
  reasonRequired = true,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      data-testid="finance-confirm-dialog"
      className="bg-background text-foreground max-w-lg rounded-lg border p-0 shadow-lg"
      onCancel={onCancel}
    >
      <WaiaSurface variant="elevated" className="space-y-4 p-5">
        <h2 className="text-lg font-medium">{title}</h2>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Impact</h3>
          <p className="text-muted-foreground text-sm">{impact}</p>
        </section>
        {reasonRequired ? (
          <div className="space-y-2">
            <label htmlFor="finance-confirm-reason" className="text-sm font-medium">
              Reason (required)
            </label>
            <Input
              id="finance-confirm-reason"
              data-testid="finance-confirm-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="finance-confirm-submit"
            onClick={onConfirm}
            disabled={busy || (reasonRequired && reason.trim() === "")}
          >
            {confirmLabel}
          </Button>
        </div>
      </WaiaSurface>
    </dialog>
  );
}
