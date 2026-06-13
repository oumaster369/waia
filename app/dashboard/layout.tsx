import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildModuleUrl, isModuleHost } from "@/lib/hosts/resolve";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  if (isModuleHost(hdrs, "trader")) {
    redirect(buildModuleUrl("primary", "/dashboard"));
  }

  const uid = await getOptionalSessionUserId();
  if (!uid) {
    redirect("/");
  }

  return <>{children}</>;
}
