export function StatusBar({ p95Ms }: { p95Ms?: number | null }) {
  if (p95Ms == null) return <p>Доставка p95 недоступна: измерений ещё нет.</p>;
  return <p>{`Доставка p95 ${p95Ms} мс`}</p>;
}
