import { redirect } from "next/navigation";

export default function AdminRuntimeAuthorityPage() {
  redirect("/admin/system?tab=controls");
}
