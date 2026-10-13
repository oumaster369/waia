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
    title: "Overview",
    description: "Equity, results and events needing attention",
    icon: LayoutDashboard,
    tabs: [
      ["summary", "Summary"],
      ["market", "Market and news"],
      ["algorithm", "Algorithm activity"],
    ],
  },
  {
    id: "accounts",
    href: "/admin/accounts",
    title: "Accounts",
    description: "Portfolios, connections and trading permissions",
    icon: WalletCards,
    tabs: [
      ["all", "All"],
      ["attention", "Needs attention"],
      ["history", "Connection history"],
    ],
  },
  {
    id: "orders",
    href: "/admin/orders",
    title: "Orders",
    description: "From decision to execution, through saved evidence",
    icon: Activity,
    tabs: [
      ["working", "Working"],
      ["all", "All"],
      ["fills", "Fills"],
      ["positions", "Positions"],
      ["closed", "Closed trades"],
    ],
  },
  {
    id: "clients",
    href: "/admin/clients",
    title: "Clients",
    description: "Organizations, billing and payment reconciliation",
    icon: Building2,
    tabs: [
      ["clients", "Clients"],
      ["invoices", "Invoices"],
      ["payments", "Payments"],
      ["periods", "Reporting periods"],
      ["disputes", "Disputes and reconciliation"],
    ],
  },
  {
    id: "strategies",
    href: "/admin/strategies",
    title: "Strategies",
    description: "Versions, evidence and actual deployments",
    icon: Layers3,
    tabs: [
      ["working", "Running"],
      ["testing", "In testing"],
      ["proposed", "Proposed"],
      ["archive", "Archive"],
    ],
  },
  {
    id: "research",
    href: "/admin/research",
    title: "Research",
    description: "Campaigns, runs and verifiable results",
    icon: Beaker,
    tabs: [
      ["campaigns", "Campaigns"],
      ["runs", "Runs"],
      ["knowledge", "Hypotheses and knowledge"],
      ["qualification", "Data and qualification"],
    ],
  },
  {
    id: "errors",
    href: "/admin/errors",
    title: "Errors",
    description: "Incidents, diagnostics and fix confirmation",
    icon: CircleAlert,
    tabs: [
      ["active", "Active incidents"],
      ["events", "Error stream"],
      ["resolved", "Resolved"],
    ],
  },
  {
    id: "system",
    href: "/admin/system",
    title: "System",
    description: "Service state and operational admission boundaries",
    icon: Server,
    tabs: [
      ["services", "Services"],
      ["sources", "Sources"],
      ["ai", "AI"],
      ["jobs", "Jobs"],
      ["authority", "Permissions and limits"],
      ["releases", "Releases"],
      ["audit", "Audit"],
    ],
  },
] as const;
export const ConsoleBrandIcon = ChartNoAxesCombined;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export function sectionForPath(pathname: string): AdminSection {
  if (
    pathname === "/admin/account-observation" ||
    pathname.startsWith("/admin/account-observation/")
  ) {
    return ADMIN_SECTIONS.find((s) => s.id === "accounts")!;
  }
  if (pathname === "/admin/strategy-promotions")
    return ADMIN_SECTIONS.find((s) => s.id === "strategies")!;
  return (
    ADMIN_SECTIONS.find(
      (s) => s.href !== "/admin" && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
    ) ?? ADMIN_SECTIONS[0]
  );
}
