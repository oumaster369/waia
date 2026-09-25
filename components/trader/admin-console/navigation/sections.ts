import {
  Activity,
  Beaker,
  Building2,
  ChartNoAxesCombined,
  CircleAlert,
  Layers3,
  LayoutDashboard,
  Server,
  WalletCards,
} from "lucide-react";

export const ADMIN_SECTIONS = [
  {
    id: "overview",
    href: "/admin",
    title: "Обзор",
    description: "Капитал, результат и события, которым нужно внимание",
    icon: LayoutDashboard,
    tabs: [
      ["summary", "Сводка"],
      ["market", "Рынок и новости"],
      ["algorithm", "Работа алгоритма"],
    ],
  },
  {
    id: "accounts",
    href: "/admin/accounts",
    title: "Счета",
    description: "Портфели, подключения и разрешения торговли",
    icon: WalletCards,
    tabs: [
      ["all", "Все"],
      ["attention", "Требуют внимания"],
      ["history", "История подключений"],
    ],
  },
  {
    id: "orders",
    href: "/admin/orders",
    title: "Ордера",
    description: "От решения до исполнения — по сохранённым доказательствам",
    icon: Activity,
    tabs: [
      ["working", "Рабочие"],
      ["all", "Все"],
      ["fills", "Исполнения"],
      ["positions", "Позиции"],
      ["closed", "Закрытые сделки"],
    ],
  },
  {
    id: "clients",
    href: "/admin/clients",
    title: "Клиенты",
    description: "Организации, расчёты и сверка платежей",
    icon: Building2,
    tabs: [
      ["clients", "Клиенты"],
      ["invoices", "Счета на оплату"],
      ["payments", "Платежи"],
      ["periods", "Отчётные периоды"],
      ["disputes", "Споры и сверка"],
    ],
  },
  {
    id: "strategies",
    href: "/admin/strategies",
    title: "Стратегии",
    description: "Версии, доказательства и фактические развёртывания",
    icon: Layers3,
    tabs: [
      ["working", "Работают"],
      ["testing", "Тестируются"],
      ["proposed", "Предложены"],
      ["archive", "Архив"],
    ],
  },
  {
    id: "research",
    href: "/admin/research",
    title: "Исследования",
    description: "Кампании, запуски и проверяемые результаты",
    icon: Beaker,
    tabs: [
      ["campaigns", "Кампании"],
      ["runs", "Запуски"],
      ["knowledge", "Гипотезы и знания"],
      ["qualification", "Данные и квалификация"],
    ],
  },
  {
    id: "errors",
    href: "/admin/errors",
    title: "Ошибки",
    description: "Инциденты, диагностика и подтверждение исправлений",
    icon: CircleAlert,
    tabs: [
      ["active", "Активные инциденты"],
      ["events", "Поток ошибок"],
      ["resolved", "Исправленные"],
    ],
  },
  {
    id: "system",
    href: "/admin/system",
    title: "Система",
    description: "Состояние сервисов и границы операционного допуска",
    icon: Server,
    tabs: [
      ["services", "Сервисы"],
      ["sources", "Источники"],
      ["ai", "ИИ"],
      ["jobs", "Задания"],
      ["authority", "Допуски и лимиты"],
      ["releases", "Релизы"],
      ["audit", "Аудит"],
    ],
  },
] as const;
export const ConsoleBrandIcon = ChartNoAxesCombined;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export function sectionForPath(pathname: string): AdminSection {
  return (
    ADMIN_SECTIONS.find(
      (s) => s.href !== "/admin" && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
    ) ?? ADMIN_SECTIONS[0]
  );
}
