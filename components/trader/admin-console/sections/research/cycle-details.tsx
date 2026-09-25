"use client";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ConsoleDialog,
  ConsoleLoading,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  CYCLE_GROUPS,
  CYCLE_STAGE_TITLES,
} from "@/lib/trader/admin-console/research/cycle-catalog";
import type { CycleTraceStage } from "@/lib/trader/admin-console/research/cycle-trace";
export function CycleDetails() {
  const context = useAdminReadContext(),
    id = context.params.get("cycle");
  const read = useAdminRead<{
    envelope: { symbol: string; evaluatedAt: string | null; terminalReasonCode: string };
    stages: CycleTraceStage[];
  }>(id ? `/api/trader/admin/console/cycles/${encodeURIComponent(id)}` : null);
  return (
    <ConsoleDialog
      open={!!id}
      title="Доказательства цикла"
      description="23 архитектурных этапа в шести группах. Сохранённая запись подтверждает факт, а не готовность всех этапов."
      onClose={() => context.update({ cycle: null })}
      wide
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : read.envelope?.data.envelope ? (
        <div className="space-y-5">
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            <p>
              {read.envelope.data.envelope.symbol} ·{" "}
              {read.envelope.data.envelope.terminalReasonCode}
            </p>
            <EvidenceTime at={read.envelope.data.envelope.evaluatedAt} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {CYCLE_GROUPS.map((group) => (
              <section className="border-waia-divider rounded-lg border p-4" key={group.id}>
                <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
                <ul className="space-y-3">
                  {group.stages.map((stageId) => {
                    const stage = read.envelope!.data.stages.find((s) => s.stageId === stageId);
                    return (
                      <li key={stageId} className="border-waia-divider border-t pt-3">
                        <p className="text-xs font-medium">
                          {stageId}. {CYCLE_STAGE_TITLES[stageId]}
                        </p>
                        {stage?.sourceId ? (
                          <>
                            <p className="text-waia-success mt-1 text-xs">
                              Есть сохранённое доказательство
                            </p>
                            <details className="text-waia-fg-muted mt-1 text-[11px]">
                              <summary className="cursor-pointer">Идентификатор записи</summary>
                              <p className="mt-1 font-mono break-all">{stage.sourceId}</p>
                            </details>
                          </>
                        ) : (
                          <DataState state="unavailable" reason="NOT_PERSISTED_FOR_CYCLE" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </ConsoleDialog>
  );
}
