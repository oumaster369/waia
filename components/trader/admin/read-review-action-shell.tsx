"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";

type ReadReviewActionShellProps = {
  title: string;
  readLabel?: string;
  reviewLabel?: string;
  readContent: React.ReactNode;
  reviewContent?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
};

/**
 * Enforces read → review → govern: mutation actions render only after read state loads.
 */
export function ReadReviewActionShell({
  title,
  readLabel = "Current state",
  reviewLabel = "Preview / eligibility",
  readContent,
  reviewContent,
  actions,
  loading = false,
  error = null,
  onReload,
}: ReadReviewActionShellProps) {
  const reviewLoaded = !loading && !error && Boolean(reviewContent);

  return (
    <WaiaSurface variant="raised" className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{title}</h2>
        {onReload ? (
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            Reload
          </Button>
        ) : null}
      </div>

      {loading ? <p className="text-muted-foreground text-sm">Loading read state…</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {!loading && !error ? (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{readLabel}</h3>
            <div className="text-sm">{readContent}</div>
          </section>

          {reviewContent ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{reviewLabel}</h3>
              <div className="text-sm">{reviewContent}</div>
            </section>
          ) : null}

          {actions ? (
            <section
              className="border-border space-y-2 border-t pt-4"
              data-testid="admin-action-panel"
              aria-disabled={!reviewLoaded && Boolean(reviewContent)}
            >
              <h3 className="text-sm font-medium">Actions</h3>
              {reviewContent && !reviewLoaded ? (
                <p className="text-muted-foreground text-xs">Load preview before mutating.</p>
              ) : null}
              <div
                className={reviewContent && !reviewLoaded ? "pointer-events-none opacity-50" : ""}
              >
                {actions}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </WaiaSurface>
  );
}
