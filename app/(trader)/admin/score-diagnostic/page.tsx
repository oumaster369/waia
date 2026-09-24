import { redirect } from "next/navigation";

export default function AdminScoreDiagnosticPage() {
  redirect("/admin/research?tab=data");
}
