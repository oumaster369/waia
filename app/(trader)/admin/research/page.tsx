import { readFileSync } from "node:fs";

import {
  loadScoreDiagnosticArtifact,
  ScoreDiagnosticReport,
} from "@/components/trader/admin/score-diagnostic-report";
import { ResearchSection } from "@/components/trader/admin-console/sections/research/research-section";

export default async function AdminResearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = searchParams ? await searchParams : {};
  const tab = typeof query.tab === "string" ? query.tab : "";
  const artifact =
    tab === "data"
      ? loadScoreDiagnosticArtifact(process.env.WAIA_SCORE_DIAGNOSTIC_REPORT_PATH, (filePath) =>
          readFileSync(filePath, "utf8"),
        )
      : null;
  return (
    <>
      {artifact ? <ScoreDiagnosticReport artifact={artifact} /> : null}
      <ResearchSection />
    </>
  );
}
