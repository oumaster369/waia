"use client";

import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";

import { ORDER_STATUS_LABELS } from "@/lib/trader/admin-console/read-models/order-trace";

export type OrderRowView = {
  id: string;
  symbol: string;
  state: string;
  label: string;
};

export function orderRowView(row: { id: string; symbol: string; state: string }): OrderRowView {
  return {
    id: row.id,
    symbol: row.symbol,
    state: row.state,
    label: ORDER_STATUS_LABELS[row.state as keyof typeof ORDER_STATUS_LABELS] ?? row.state,
  };
}

export function OrdersPanel({ rows }: { rows: readonly OrderRowView[] }) {
  const parent = React.useRef<HTMLDivElement>(null);
  const data = React.useMemo(() => [...rows], [rows]);
  // TanStack Table returns functions the React compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: [
      { accessorKey: "symbol", header: "Инструмент" },
      { accessorKey: "label", header: "Статус" },
    ],
    getCoreRowModel: getCoreRowModel(),
  });
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 40,
  });
  return (
    <div ref={parent}>
      <table>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">{virtualizer.getTotalSize()}</span>
    </div>
  );
}
