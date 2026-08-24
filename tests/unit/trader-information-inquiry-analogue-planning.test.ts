import { describe, expect, it } from "vitest";

import { classifyHistoricalAnaloguePlanningDispositionV1 } from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";

describe("DEE-697 historical analogue planning", () => {
  it.each([
    [null, "QUERY_REQUIRED"],
    ["MATCHED_QUALIFIED_KNOWLEDGE", "QUALIFIED_KNOWLEDGE_AVAILABLE"],
    ["NO_MATCHING_OCCURRENCE", "NO_MATCHING_OCCURRENCE"],
    ["NO_QUALIFIED_RELATION_KNOWLEDGE", "ROUTE_RESEARCH_QUESTION_DEE_646"],
    ["QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE", "UNRESOLVED_KNOWLEDGE"],
    ["HISTORY_UNAVAILABLE_OR_UNQUALIFIED", "HISTORY_UNAVAILABLE"],
  ] as const)("maps %s to the exact non-synthesizing disposition", (status, disposition) => {
    expect(classifyHistoricalAnaloguePlanningDispositionV1(status)).toBe(disposition);
  });
});
