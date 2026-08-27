import Link from "next/link";

import { cn } from "@/lib/utils";

export function WaiaAdminModuleNav({
  finance,
  hr,
  active,
}: {
  finance: boolean;
  hr: boolean;
  active?: "home" | "finance" | "hr";
}) {
  const links = [
    { href: "/waia-admin", label: "Admin home", id: "home", visible: true },
    { href: "/finance", label: "Finance", id: "finance", visible: finance },
    { href: "/hr", label: "HR", id: "hr", visible: hr },
  ] as const;
  return (
    <aside
      className="border-border h-fit border-l pl-5 lg:sticky lg:top-8"
      aria-label="WAIA Admin modules"
    >
      <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA Admin</p>
      <nav className="mt-3 flex flex-col gap-1">
        {links
          .filter((item) => item.visible)
          .map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                active === item.id
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {item.label}
            </Link>
          ))}
      </nav>
    </aside>
  );
}
