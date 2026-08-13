/**
 * Public module readiness for the homepage (DEE-605 corrective).
 *
 * Authority: qualitative maturity labels from docs/WAIA-CANONICAL-ARCHITECTURE.md.
 * No fabricated percentages. Mixed maturity is shown as explicit facets, never averaged.
 */

export type MaturityLabel = "Concept" | "Research" | "Prototype" | "Operational" | "Production";

/** Ordered qualitative scale — Concept → Research → Prototype → Operational → Production. */
export const MATURITY_SCALE: ReadonlyArray<MaturityLabel> = [
  "Concept",
  "Research",
  "Prototype",
  "Operational",
  "Production",
] as const;

export type HomepageModuleId =
  | "ai-twin"
  | "society"
  | "business-3p"
  | "ai-trader"
  | "ai-marketplace"
  | "waia-core"
  | "waia-dev-os";

export type MaturityFacet = {
  /** Short facet name from canon (e.g. "Core journey", "Paper trading"). */
  name: string;
  label: MaturityLabel;
  note?: string;
};

export type ModuleReadiness = {
  id: HomepageModuleId;
  name: string;
  /**
   * Primary highlight on the five-stage scale — the highest stage current
   * canonical evidence supports for the module’s main public story.
   * Facets remain authoritative when maturity is mixed.
   */
  primaryLabel: MaturityLabel;
  facets: ReadonlyArray<MaturityFacet>;
  lastUpdatedAt: string;
  evidenceNote: string;
};

/**
 * Canon reference date for the synthesis used on the public homepage.
 * Update when underlying architecture maturity labels change.
 */
export const READINESS_METHODOLOGY_UPDATED_AT = "2026-07-03" as const;

/**
 * Authoritative homepage readiness rows — qualitative only.
 * Source: docs/WAIA-CANONICAL-ARCHITECTURE.md maturity tables.
 */
export const HOMEPAGE_MODULE_READINESS: ReadonlyArray<ModuleReadiness> = [
  {
    id: "ai-twin",
    name: "AI-TWIN",
    primaryLabel: "Operational",
    facets: [
      {
        name: "Core journey",
        label: "Operational",
        note: "Landing, auth, dashboard, Twin dialogue, readiness, Diary",
      },
      { name: "Society preview / Socialization", label: "Prototype" },
      { name: "Avatar", label: "Prototype", note: "Placeholder only" },
    ],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote:
      "Canonical architecture: Operational for MVP partner-preview path; Prototype for Society network and avatar.",
  },
  {
    id: "society",
    name: "Society",
    primaryLabel: "Prototype",
    facets: [
      { name: "Private Society preview UI", label: "Prototype" },
      { name: "Public social network / matching", label: "Concept" },
      {
        name: "Collective intelligence",
        label: "Research",
        note: "Vision-tier — not engineering law",
      },
    ],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote:
      "Canonical architecture: Prototype (preview); social network Concept; collective intelligence Research (vision-tier).",
  },
  {
    id: "business-3p",
    name: "3P (Business)",
    primaryLabel: "Concept",
    facets: [{ name: "Module", label: "Concept", note: "Named; no product runtime yet" }],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote: "Canonical architecture: Concept (+ landing placeholders).",
  },
  {
    id: "ai-trader",
    name: "AI-TRADER",
    primaryLabel: "Prototype",
    facets: [
      { name: "Module overall", label: "Prototype" },
      { name: "Paper / mock proving path", label: "Operational" },
      {
        name: "Live capital path",
        label: "Prototype",
        note: "Code present; governance-blocked — not production-enabled",
      },
      { name: "Market Intelligence spine", label: "Prototype" },
      { name: "Research Intelligence (CLI)", label: "Operational" },
    ],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote:
      "Canonical architecture: Prototype (module) / Operational (paper) / Prototype (live — governance-blocked). No invented aggregate score.",
  },
  {
    id: "ai-marketplace",
    name: "AI-Marketplace",
    primaryLabel: "Concept",
    facets: [{ name: "Module", label: "Concept", note: "Future need/context matching" }],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote: "Canonical architecture: Concept (+ landing placeholders).",
  },
  {
    id: "waia-core",
    name: "WAIA Core",
    primaryLabel: "Operational",
    facets: [
      { name: "Identity / session paths", label: "Operational" },
      { name: "Tenancy / entitlements (architecture target)", label: "Operational" },
      {
        name: "Full Core uplift in codebase",
        label: "Prototype",
        note: "Core architecture notes staged uplift vs live AI-TWIN tables",
      },
    ],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote:
      "Canonical architecture Core domains listed Operational; codebase uplift still staged — facets shown explicitly.",
  },
  {
    id: "waia-dev-os",
    name: "WAIA DEV OS",
    primaryLabel: "Operational",
    facets: [
      {
        name: "Engineering operating system",
        label: "Operational",
        note: "Plans, Linear lifecycle, PR gates",
      },
    ],
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    evidenceNote: "Canonical architecture: DEV OS Operational.",
  },
];

export function getModuleReadiness(id: HomepageModuleId): ModuleReadiness {
  const row = HOMEPAGE_MODULE_READINESS.find((m) => m.id === id);
  if (!row) throw new Error(`Unknown homepage module readiness id: ${id}`);
  return row;
}

export function maturityStageIndex(label: MaturityLabel): number {
  return MATURITY_SCALE.indexOf(label);
}
