import { RU } from "@/components/trader/admin-console/i18n/ru";
import { AdminTimeSeriesChart } from "@/components/trader/admin-console/primitives/time-series-chart";

export default function AdminSystemPage() {
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-semibold">{RU.sections.system}</h2>
      <AdminTimeSeriesChart />
    </section>
  );
}
