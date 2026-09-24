import { describe, expect, it } from "vitest";

import { assistantHelpEntries } from "@/lib/trader/admin-console/assistant/help";
import { QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

describe("admin assistant help", () => {
  it("lists only wired read tools and does not teach a trade or holdout", () => {
    const entries = assistantHelpEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(ADMIN_TOOLS).toContain(entry.tool);
      expect(entry.title).toMatch(/\p{Script=Cyrillic}/u);
      expect(entry.example.length).toBeGreaterThan(0);
    }
    const names = entries.map((entry) => entry.tool);
    expect(names).not.toContain("place_order");
    expect(names).not.toContain("list_cycles");
    expect(names).not.toContain("get_cycle_evidence");
  });

  it("marks every quick answer as running without a language model", () => {
    expect(QUICK_ANSWERS.length).toBeGreaterThan(0);
    for (const answer of QUICK_ANSWERS) {
      expect(answer.withoutModel).toBe(true);
      for (const tool of answer.tools) expect(ADMIN_TOOLS).toContain(tool);
    }
  });
});
