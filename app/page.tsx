import { redirect } from "next/navigation";

import { LandingPageContent } from "@/components/landing/landing-page-content";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";

export default async function LandingPage() {
  const uid = await getOptionalSessionUserId();
  if (uid) {
    redirect("/dashboard");
  }

  return <LandingPageContent />;
}
