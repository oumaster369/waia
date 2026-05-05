import { redirect } from "next/navigation";

import { getOptionalSessionUserId } from "@/lib/auth/session-user";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const uid = await getOptionalSessionUserId();
  if (!uid) {
    redirect("/");
  }

  return <>{children}</>;
}
