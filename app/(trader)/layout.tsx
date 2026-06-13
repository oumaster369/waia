import { redirect } from "next/navigation";

import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildModuleUrl } from "@/lib/hosts/resolve";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";

export default async function TraderModuleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    redirect("/");
  }

  const allowed = await hasTraderAccessForUser(userId);
  if (!allowed) {
    redirect(buildModuleUrl("primary", "/dashboard"));
  }

  return <>{children}</>;
}
