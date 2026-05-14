import { describe, expect, it } from "vitest";

import { buildBoundedDialogueContinuityReplay } from "@/lib/twin-dialogue/build-dialogue-continuity-replay";
import {
  DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS,
  DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN,
  DIALOGUE_CONTINUITY_MAX_REPLAY_MESSAGES,
} from "@/lib/twin-dialogue/dialogue-continuity-config";
import type { TwinDialogueTurnDbRow } from "@/lib/twin-persistence/loader";

function row(
  partial: Pick<TwinDialogueTurnDbRow, "role" | "content" | "sequence">,
): TwinDialogueTurnDbRow {
  return {
    id: crypto.randomUUID(),
    idempotencyKey: null,
    createdAt: new Date(),
    ...partial,
  };
}

describe("buildBoundedDialogueContinuityReplay", () => {
  it("returns empty when tail is empty", () => {
    const out = buildBoundedDialogueContinuityReplay([]);
    expect(out.priorMessages).toEqual([]);
    expect(out.replayRolesInjected).toBe(0);
    expect(out.replayCharsTotal).toBe(0);
    expect(out.replayTruncated).toBe(false);
  });

  it("prefers newest exchanges and respects message count cap", () => {
    const rows: TwinDialogueTurnDbRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(
        row({
          sequence: i + 1,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `m${i}`,
        }),
      );
    }
    const out = buildBoundedDialogueContinuityReplay(rows);
    expect(out.priorMessages.length).toBeLessThanOrEqual(DIALOGUE_CONTINUITY_MAX_REPLAY_MESSAGES);
    expect(out.priorMessages.length).toBe(6);
    expect(out.priorMessages[0]?.content).toBe("m4");
    expect(out.priorMessages[out.priorMessages.length - 1]?.content).toBe("m9");
  });

  it("skips system roles", () => {
    const rows = [
      row({ sequence: 1, role: "user", content: "hi" }),
      row({ sequence: 2, role: "assistant", content: "hey" }),
      row({ sequence: 3, role: "system", content: "ignore-me" }),
    ];
    const out = buildBoundedDialogueContinuityReplay(rows);
    expect(out.priorMessages.map((m) => m.role).join(",")).not.toContain("system");
    expect(out.priorMessages.length).toBe(2);
  });

  it("marks truncated when total char budget exceeded", () => {
    const long = "z".repeat(DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN);
    const rows = [
      row({ sequence: 1, role: "user", content: long }),
      row({ sequence: 2, role: "assistant", content: long }),
      row({ sequence: 3, role: "user", content: long }),
      row({ sequence: 4, role: "assistant", content: long }),
    ];
    const out = buildBoundedDialogueContinuityReplay(rows);
    expect(out.replayTruncated).toBe(true);
    expect(out.replayCharsTotal).toBeLessThanOrEqual(DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS);
  });

  it("clips a single overheavy turn preserving tail semantics", () => {
    const long = "abc".repeat(500);
    const rows = [
      row({ sequence: 1, role: "user", content: long }),
      row({ sequence: 2, role: "assistant", content: `ENDMARKER-${"x".repeat(20)}` }),
    ];
    const out = buildBoundedDialogueContinuityReplay(rows);
    expect(out.priorMessages[out.priorMessages.length - 1]?.content).toContain("ENDMARKER");
    expect(out.replayTruncated).toBe(true);
    for (const m of out.priorMessages) {
      expect(m.content.length).toBeLessThanOrEqual(DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN);
    }
  });
});
