import Link from "next/link";

const LINKS = {
  system: [
    { href: "/admin/system?tab=audit", label: "Audit log" },
    { href: "/admin/system?tab=authority", label: "Execution authority" },
    { href: "/admin/kill-switches", label: "Emergency switches" },
    { href: "/admin/live-enable", label: "Live admission" },
  ],
  strategies: [{ href: "/admin/strategy-promotions", label: "Strategy promotions" }],
  research: [
    { href: "/admin/fhv-operations", label: "Research operations" },
    { href: "/admin/research?tab=qualification", label: "Valuation diagnostics" },
    { href: "/admin/research/discovery", label: "Discovery" },
    { href: "/admin/account-observation", label: "Account observation" },
  ],
} as const;

export function GovernedProcessLinks({ section }: { section: keyof typeof LINKS }) {
  return (
    <nav aria-label="Governed workflows">
      {LINKS[section].map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
