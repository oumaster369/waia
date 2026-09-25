"use client";

import { useState } from "react";
import {
  ConsolePanel,
  ConsoleTable,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import type { AccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";

export function AccountAssets({
  finance,
}: {
  finance: Pick<AccountFinance, "assets" | "currency" | "method" | "observedAt" | "reason">;
}) {
  const [showZero, setShowZero] = useState(false);
  const assets = finance.assets ?? [];
  const zero = (value: string) => /^-?0+(?:\.0+)?$/.test(value);
  const visible = assets.filter(
    (asset) => asset.asset.toUpperCase() === "USDT" || !zero(asset.free) || !zero(asset.locked),
  );
  const hiddenCount = assets.length - visible.length;
  return (
    <ConsolePanel
      title="Наблюдаемые активы"
      note={`Оценка ${finance.currency}; метод ${finance.method}. Включает количество, заблокированное в sell-ордерах.`}
    >
      {hiddenCount > 0 ? (
        <div className="border-waia-divider border-b px-5 py-3">
          <button
            type="button"
            aria-expanded={showZero}
            onClick={() => setShowZero(!showZero)}
            className="text-waia-fg-muted hover:text-waia-fg rounded text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            {showZero ? "Скрыть нулевые остатки" : `Показать нулевые остатки (${hiddenCount})`}
          </button>
        </div>
      ) : null}
      {assets.length ? (
        visible.length || showZero ? (
          <ConsoleTable
            rows={showZero ? assets : visible}
            rowKey={(row) => row.asset}
            caption="Активы счёта"
            columns={[
              { title: "Актив", render: (row) => row.asset },
              { title: "Свободно", align: "right", render: (row) => row.free },
              { title: "В ордерах", align: "right", render: (row) => row.locked },
              {
                title: "Рыночная стоимость",
                align: "right",
                render: (row) =>
                  row.value === null ? (
                    <DataState state={row.state} reason={row.reasons[0]} />
                  ) : (
                    <div>
                      {formatAdminMoney(row.value, finance.currency)}
                      {row.reasons.map((reason) => (
                        <DataState key={reason} state={row.state} reason={reason} />
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        ) : (
          <p className="text-waia-fg-muted p-5 text-sm">
            Все наблюдаемые остатки подтверждены как нулевые.
          </p>
        )
      ) : (
        <div className="p-5">
          <DataState
            state={finance.observedAt ? "empty" : "unavailable"}
            reason={finance.observedAt ? "NO_ASSETS_OBSERVED" : finance.reason}
          />
        </div>
      )}
    </ConsolePanel>
  );
}
