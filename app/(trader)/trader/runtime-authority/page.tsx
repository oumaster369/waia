import { RuntimeAuthorityCard } from "@/components/trader/runtime-authority/runtime-authority-card";
export const dynamic = "force-dynamic";
export default function RuntimeAuthorityPage() {
  return <main className="mx-auto max-w-3xl space-y-4 p-6"><h1 className="text-2xl font-semibold">System posture</h1>
    <RuntimeAuthorityCard endpoint="/api/trader/runtime-authority" /></main>;
}
