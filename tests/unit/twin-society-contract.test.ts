import { describe, expect, it } from "vitest";

import {
  TWIN_READINESS_SCHEMA_VERSION,
  type TwinReadinessResult,
} from "@/lib/dashboard/twin-readiness-api.types";
import {
  TWIN_PROFILE_SCHEMA_VERSION,
  type TwinProfile,
} from "@/lib/dashboard/twin-profile-api.types";
import {
  SOCIETY_VISIBILITY_NOTICE_V1,
  SOCIALIZATION_EFFECT_V1,
  SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1,
  TWIN_SOCIETY_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-society-api.types";
import {
  buildSocietyContentMap,
  deriveSocializationStatus,
  getSocializationAction,
} from "@/lib/reasoning/twin-society-contract";

function readiness(level: TwinReadinessResult["level"]): TwinReadinessResult {
  return {
    schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
    scores: {
      baseModel: 0.2,
      memory: 0.3,
      patterns: 0.4,
      contradictions: 0.5,
      consistency: 0.6,
      feedback: 0.7,
    },
    overall: level === "high" ? 0.92 : level === "medium" ? 0.55 : 0.2,
    level,
  };
}

function minimalProfile(overrides?: Partial<TwinProfile>): TwinProfile {
  const base: TwinProfile = {
    schemaVersion: TWIN_PROFILE_SCHEMA_VERSION,
    identity: {
      title: "Sample Twin",
      shortDescription: "Twin profile body copy.",
      dominantTraits: [],
    },
    expression: {
      tone: "balanced",
      communicationStyle: [],
    },
    behavior: {
      decisionStyle: [],
      relationshipStyle: [],
    },
    emotionalProfile: {
      emotionalPatterns: [],
    },
    contradictions: {
      contradictions: [],
    },
    readiness: {
      level: "low",
    },
    visibility: {
      isPublic: false,
    },
  };
  return { ...base, ...overrides };
}

describe("twin-society-contract (DEE-53)", () => {
  it("deriveSocializationStatus: low and medium → not_ready", () => {
    const p = minimalProfile();
    expect(
      deriveSocializationStatus({ profile: p, readiness: readiness("low") }),
    ).toBe("not_ready");
    expect(
      deriveSocializationStatus({ profile: p, readiness: readiness("medium") }),
    ).toBe("not_ready");
  });

  it("deriveSocializationStatus: high with no flags → ready_to_start", () => {
    expect(
      deriveSocializationStatus({
        profile: minimalProfile({ readiness: { level: "high" } }),
        readiness: readiness("high"),
      }),
    ).toBe("ready_to_start");
  });

  it("deriveSocializationStatus: socializationCompleted → socialized (dominates level)", () => {
    expect(
      deriveSocializationStatus({
        profile: minimalProfile(),
        readiness: readiness("low"),
        socializationCompleted: true,
      }),
    ).toBe("socialized");
  });

  it("deriveSocializationStatus: in progress → socializing", () => {
    expect(
      deriveSocializationStatus({
        profile: minimalProfile(),
        readiness: readiness("high"),
        socializationInProgress: true,
      }),
    ).toBe("socializing");
    expect(
      deriveSocializationStatus({
        profile: minimalProfile(),
        readiness: readiness("low"),
        socializationInProgress: true,
      }),
    ).toBe("socializing");
  });

  it("getSocializationAction is deterministic and uses fixed literals", () => {
    const r = getSocializationAction({
      profile: minimalProfile(),
      readiness: readiness("high"),
    });
    const r2 = getSocializationAction({
      profile: minimalProfile(),
      readiness: readiness("high"),
    });
    expect(JSON.stringify(r)).toBe(JSON.stringify(r2));
    expect(r.action).toBe("start_socialization");
    expect(r.requiredReadinessLevel).toBe(SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1);
    expect(r.requiresPublicProfile).toBe(false);
    expect(r.effect).toBe(SOCIALIZATION_EFFECT_V1);
    expect(r.allowed).toBe(true);
  });

  it("getSocializationAction blocked when not_ready", () => {
    const r = getSocializationAction({
      profile: minimalProfile(),
      readiness: readiness("medium"),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("high");
  });

  it("buildSocietyContentMap uses TwinProfile fields on profile card", () => {
    const profile = minimalProfile({
      identity: {
        title: "Nova",
        shortDescription: "Nova copy",
        dominantTraits: ["curious", "direct", "steady"],
      },
      expression: {
        tone: "warm",
        communicationStyle: [],
      },
    });
    const map = buildSocietyContentMap({
      profile,
      readiness: readiness("high"),
    });
    expect(map.schemaVersion).toBe(TWIN_SOCIETY_SCHEMA_VERSION);
    expect(map.profileCard.title).toBe("Nova");
    expect(map.profileCard.shortDescription).toBe("Nova copy");
    expect(map.profileCard.tone).toBe("warm");
    expect(map.profileCard.traitSummary).toBe("curious, direct, steady");
    expect(map.readinessBadge).toContain("high");
    expect(map.visibilityNotice).toBe(SOCIETY_VISIBILITY_NOTICE_V1);
  });

  it("visibility notice asserts private v1 and no feed or matching", () => {
    const n = SOCIETY_VISIBILITY_NOTICE_V1.toLowerCase();
    expect(n).toContain("private");
    expect(n).toContain("no public");
    expect(n).toContain("no discovery or matching");
    expect(n).toContain("no social graph");
    expect(n).toContain("no external sharing");
  });

  it("trait summary fall back when no traits", () => {
    const map = buildSocietyContentMap({
      profile: minimalProfile({ identity: { ...minimalProfile().identity, dominantTraits: [] } }),
      readiness: readiness("high"),
    });
    expect(map.profileCard.traitSummary).toBe("No dominant trait labels yet.");
  });

  it("outputs avoid promotional public-feed language", () => {
    const map = buildSocietyContentMap({
      profile: minimalProfile(),
      readiness: readiness("high"),
    });
    const blob = JSON.stringify(map).toLowerCase();
    expect(blob).not.toMatch(/\bpublic\s+feed\s+for\s+your\b/);
    expect(blob).not.toMatch(/\bfind\s+friends\b/);
  });
});
