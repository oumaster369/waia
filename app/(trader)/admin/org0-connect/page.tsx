import { Org0ReadonlyConnect } from "@/components/trader/admin/org0-readonly-connect";

export default function Org0ConnectPage() {
  return (
    <main className="max-w-2xl space-y-5">
      <header className="space-y-2">
        <h1 className="text-waia-fg text-xl font-semibold">Подключение HTX к Org0</h1>
        <p className="text-waia-fg-muted text-sm leading-6">
          Здесь можно добавить отдельный ключ только для счёта HTX 73737331. Личная запись и её
          история останутся без изменений.
        </p>
      </header>
      <Org0ReadonlyConnect />
    </main>
  );
}
