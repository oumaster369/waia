import Link from "next/link";

const LINKS = {
  system: [
    { href: "/admin/system?tab=audit", label: "Журнал аудита" },
    { href: "/admin/system?tab=controls", label: "Полномочия исполнения" },
    { href: "/admin/kill-switches", label: "Аварийные выключатели" },
    { href: "/admin/live-enable", label: "Допуск к live" },
  ],
  strategies: [{ href: "/admin/strategy-promotions", label: "Продвижение стратегий" }],
  research: [
    { href: "/admin/fhv-operations", label: "Операции исследования" },
    { href: "/admin/research?tab=data", label: "Диагностика оценки" },
    { href: "/admin/account-observation", label: "Наблюдение счетов" },
  ],
} as const;

export function GovernedProcessLinks({ section }: { section: keyof typeof LINKS }) {
  return (
    <nav aria-label="Управляемые процессы">
      {LINKS[section].map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
