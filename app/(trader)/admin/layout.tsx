import { AdminShell } from "@/components/trader/admin/admin-shell";

/**
 * Static presentation shell only. Administrative authority is intentionally
 * checked by every `/api/trader/admin/**` endpoint before any organization or
 * campaign data is returned. Keeping DB/session work out of SSR avoids spending
 * the Cloudflare request CPU budget twice without weakening the API boundary.
 */
export default function TraderAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AdminShell>{children}</AdminShell>;
}
