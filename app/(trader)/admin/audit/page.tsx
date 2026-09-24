import { redirect } from "next/navigation";

export default function AdminAuditPage() {
  redirect("/admin/system?tab=audit");
}
