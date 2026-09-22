import { readFileSync } from "node:fs";

import {
  loadScoreDiagnosticArtifact,
  ScoreDiagnosticReport,
} from "@/components/trader/admin/score-diagnostic-report";

export default function AdminScoreDiagnosticPage() {
  const artifact = loadScoreDiagnosticArtifact(
    process.env.WAIA_SCORE_DIAGNOSTIC_REPORT_PATH,
    (filePath) => readFileSync(filePath, "utf8"),
  );
  return (
    <main className="space-y-5">
      <ScoreDiagnosticReport artifact={artifact} />
    </main>
  );
}
