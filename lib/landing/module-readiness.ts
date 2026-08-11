/**
 * Public module readiness for the homepage (DEE-605).
 *
 * Authority: maturity labels from docs/WAIA-CANONICAL-ARCHITECTURE.md.
 * Percentages are derived from the declared label→score map below — not from
 * marketing decks or informal averaging of adjectives.
 */

export type MaturityLabel =
  | "Concept"
  | "Research"
  | "Prototype"
  | "Operational"
  | "Production";

export type HomepageModuleId =
  | "ai-twin"
  | "society"
  | "business-3p"
  | "ai-trader"
  | "ai-marketplace"
  | "waia-core"
  | "waia-dev-os";

/** Declared score map — single methodology for public %. */
export const MATURITY_SCORE: Record<MaturityLabel, number> = {
  Concept: 10,
  Research: 25,
  Prototype: 45,
  Operational: 70,
  Production: 95,
};

export type ModuleReadiness = {
  id: HomepageModuleId;
  name: string;
  maturity: MaturityLabel;
  /** 0–100, derived from declared methodology (never invented from decks). */
  percent: number;
  lastUpdatedAt: string;
  methodology: string;
};

/**
 * Canon reference date for the synthesis used on the public homepage.
 * Update when the readiness methodology or underlying canon labels change.
 */
export const READINESS_METHODOLOGY_UPDATED_AT = "2026-07-03" as const;

function score(label: MaturityLabel): number {
  return MATURITY_SCORE[label];
}

/**
 * Weighted blend of declared maturity facets. Weights must sum to 1.
 * Used only when a module has documented mixed maturity in architecture canon.
 */
function weightedPercent(
  facets: ReadonlyArray<{ label: MaturityLabel; weight: number }>,
): number {
  const totalWeight = facets.reduce((sum, f) => sum + f.weight, 0);
  if (Math.abs(totalWeight - 1) > 1e-9) {
    throw new Error("Readiness facet weights must sum to 1");
  }
  const raw = facets.reduce((sum, f) => sum + score(f.label) * f.weight, 0);
  return Math.round(raw);
}

/**
 * Authoritative homepage readiness rows.
 * Mixed modules use explicit weights documented in `methodology`.
 */
export const HOMEPAGE_MODULE_READINESS: ReadonlyArray<ModuleReadiness> = [
  {
    id: "ai-twin",
    name: "AI-TWIN",
    maturity: "Operational",
    percent: weightedPercent([
      { label: "Operational", weight: 0.7 },
      { label: "Prototype", weight: 0.3 },
    ]),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology:
      "70% Operational (MVP partner-preview path: auth, dashboard, Twin dialogue, readiness) + 30% Prototype (Society network / avatar still incomplete).",
  },
  {
    id: "society",
    name: "Society",
    maturity: "Prototype",
    percent: weightedPercent([
      { label: "Prototype", weight: 0.6 },
      { label: "Concept", weight: 0.4 },
    ]),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology:
      "60% Prototype (private Society preview shell) + 40% Concept (public social network / matching still future).",
  },
  {
    id: "business-3p",
    name: "3P (Business)",
    maturity: "Concept",
    percent: score("Concept"),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology: "Single canon label Concept — named on landing/architecture; no product runtime yet.",
  },
  {
    id: "ai-trader",
    name: "AI-TRADER",
    maturity: "Prototype",
    percent: weightedPercent([
      { label: "Research", weight: 0.35 },
      { label: "Prototype", weight: 0.55 },
      { label: "Concept", weight: 0.1 },
    ]),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology:
      "35% Research (doctrine/constitution), 55% Prototype (in-repo intelligence/research surfaces), 10% Concept (external live trading / user income instrument gated — ADR-0009 uncleared).",
  },
  {
    id: "ai-marketplace",
    name: "AI-Marketplace",
    maturity: "Concept",
    percent: score("Concept"),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology: "Single canon label Concept — future need/context matching layer.",
  },
  {
    id: "waia-core",
    name: "WAIA Core",
    maturity: "Prototype",
    percent: weightedPercent([
      { label: "Operational", weight: 0.35 },
      { label: "Prototype", weight: 0.4 },
      { label: "Concept", weight: 0.25 },
    ]),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology:
      "35% Operational (identity/session paths in production use), 40% Prototype (payments/audit slices), 25% Concept (full tenancy uplift still in progress per Core architecture).",
  },
  {
    id: "waia-dev-os",
    name: "WAIA DEV OS",
    maturity: "Operational",
    percent: score("Operational"),
    lastUpdatedAt: READINESS_METHODOLOGY_UPDATED_AT,
    methodology:
      "Operational engineering operating system (plans, Linear lifecycle, PR gates) — user-facing explanation only on the homepage.",
  },
];

export function getModuleReadiness(id: HomepageModuleId): ModuleReadiness {
  const row = HOMEPAGE_MODULE_READINESS.find((m) => m.id === id);
  if (!row) throw new Error(`Unknown homepage module readiness id: ${id}`);
  return row;
}
