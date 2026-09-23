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
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.symbol}</td>
            <td>{row.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
