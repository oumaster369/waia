"use client";
import * as React from "react";
import { AdminOrgSelector, useAdminOrganizations } from "@/components/trader/admin/admin-org-selector";
import { RuntimeAuthorityCard } from "@/components/trader/runtime-authority/runtime-authority-card";
export default function AdminRuntimeAuthorityPage() {
  const { organizations } = useAdminOrganizations();
  const [selected, setSelected] = React.useState("");
  const organizationId = selected || organizations[0]?.id || "";
  return <main className="space-y-4"><h1 className="text-2xl font-semibold">Runtime Authority operations</h1>
    <AdminOrgSelector organizations={organizations} value={organizationId} onChange={setSelected} />
    {organizationId ? <RuntimeAuthorityCard endpoint={`/api/trader/admin/runtime-authority?organization_id=${encodeURIComponent(organizationId)}`} />
      : <p>UNAVAILABLE — select an authorized organization.</p>}</main>;
}
