export const HTR_READINESS_GATE_GROUP_IDS = [
  "CG-Gov",
  "CG-A",
  "CG-B",
  "CG-C",
  "CG-D",
  "CG-E",
  "CG-F",
  "CG-G",
  "CG-H",
] as const;

export type HtrReadinessGateGroupId = (typeof HTR_READINESS_GATE_GROUP_IDS)[number];

export type HtrReadinessGateGroupDefinition = Readonly<{
  id: HtrReadinessGateGroupId;
  title: string;
  ownerWorkPackages: readonly string[];
  preflightRequired: boolean;
  phaseAOpenGaps?: readonly string[];
}>;

export const HTR_READINESS_GATE_GROUPS: readonly HtrReadinessGateGroupDefinition[] = [
  {
    id: "CG-Gov",
    title: "Governance and activation",
    ownerWorkPackages: ["HTR-WP01", "HTR-WP23"],
    preflightRequired: true,
  },
  {
    id: "CG-A",
    title: "Data and dataset",
    ownerWorkPackages: ["HTR-WP11", "HTR-WP12", "HTR-WP23"],
    preflightRequired: true,
    phaseAOpenGaps: ["HTR-GAP-028"],
  },
  {
    id: "CG-B",
    title: "Replay runtime",
    ownerWorkPackages: ["HTR-WP03", "HTR-WP05", "HTR-WP10", "HTR-WP22"],
    preflightRequired: true,
    phaseAOpenGaps: ["HTR-GAP-005", "HTR-GAP-024", "HTR-GAP-026", "HTR-GAP-027", "HTR-GAP-029"],
  },
  {
    id: "CG-C",
    title: "Market Canvas and MTF",
    ownerWorkPackages: ["HTR-WP06", "HTR-WP07", "HTR-WP08", "HTR-WP09"],
    preflightRequired: true,
  },
  {
    id: "CG-D",
    title: "Decision chain (record-level)",
    ownerWorkPackages: ["HTR-WP13", "HTR-WP14", "HTR-WP15", "HTR-WP16"],
    preflightRequired: true,
  },
  {
    id: "CG-E",
    title: "Trading simulation and reality",
    ownerWorkPackages: ["HTR-WP17", "HTR-WP18", "HTR-WP19"],
    preflightRequired: true,
    phaseAOpenGaps: ["HTR-GAP-043"],
  },
  {
    id: "CG-F",
    title: "Guardian and exits",
    ownerWorkPackages: ["HTR-WP20"],
    preflightRequired: true,
  },
  {
    id: "CG-G",
    title: "Evidence, quality, ops, Execution Server package",
    ownerWorkPackages: ["HTR-WP04", "HTR-WP22", "HTR-WP23"],
    preflightRequired: true,
    phaseAOpenGaps: ["HTR-GAP-028", "HTR-GAP-042"],
  },
  {
    id: "CG-H",
    title: "Outcome resolution, calibration, knowledge confidence",
    ownerWorkPackages: ["HTR-WP14", "HTR-WP21"],
    preflightRequired: true,
  },
] as const;

export function getHtrReadinessGateGroup(
  id: HtrReadinessGateGroupId,
): HtrReadinessGateGroupDefinition {
  const group = HTR_READINESS_GATE_GROUPS.find((entry) => entry.id === id);
  if (!group) {
    throw new Error(`HTR_WP23_GATE_GROUPS:UNKNOWN_GROUP:${id}`);
  }
  return group;
}

export function listHtrReadinessGateGroupsRequiringPreflight(): readonly HtrReadinessGateGroupDefinition[] {
  return HTR_READINESS_GATE_GROUPS.filter((group) => group.preflightRequired);
}
