import { redirect } from "next/navigation";

type BillingSearch = { organization_id?: string };

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<BillingSearch>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ tab: "invoices" });
  if (params.organization_id) query.set("organization_id", params.organization_id);
  redirect(`/admin/clients?${query.toString()}`);
}
