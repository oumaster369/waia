/** Metadata only. Holdout payloads and research reasoning are deliberately absent. */
export type ResearchCatalogItem = {
  id: string;
  organizationId: string;
  kind: "campaign" | "hypothesis" | "edge" | "dataset" | "qualification";
  title: string;
  state: string | null;
  version: string | null;
  symbol: string | null;
  observedAt: string | null;
  evidenceRef: string | null;
};
export type ResearchCatalog = {
  items: ResearchCatalogItem[];
  total: number | null;
  state: "ok" | "empty" | "partial" | "not_applicable";
  reasons: string[];
  modeApplicability: "research_metadata";
};
