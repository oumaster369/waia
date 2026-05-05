import { describe, expect, it } from "vitest";

import { TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION } from "@/lib/dashboard/twin-memory-channel-api.types";
import type { TwinMemoryChannelId } from "@/lib/dashboard/twin-memory-channel-api.types";
import {
  classifyTwinMemoryInput,
  getTwinMemoryChannelContract,
  listTwinMemoryChannelContracts,
  TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE,
} from "@/lib/reasoning/twin-memory-channel-contracts";
import { PERSONALITY_MODEL_CLINICAL_BLOCKLIST } from "@/lib/reasoning/twin-personality-model-contract";

const DOWNSTREAM_TOKENS = [
  "pattern_summary",
  "prediction",
  "contradictions",
  "repeatability",
  "personality_model",
  "readiness",
] as const;

function containsClinicalNeedle(lower: string): boolean {
  for (const needle of PERSONALITY_MODEL_CLINICAL_BLOCKLIST) {
    if (lower.includes(needle)) {
      return true;
    }
  }
  return false;
}

function collectBundleText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectBundleText);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectBundleText);
  }
  return [];
}

describe("twin-memory-channel-contracts", () => {
  it("exposes stable schema and both channels", () => {
    expect(TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.schemaVersion).toBe(
      TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION,
    );
    expect(Object.keys(TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels).sort()).toEqual(
      ["diary", "twin_chat"].sort(),
    );
  });

  it("keeps required contract fields for each channel", () => {
    for (const key of ["diary", "twin_chat"] as const) {
      const c = TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels[key];
      expect(c.purpose.length).toBeGreaterThan(40);
      expect(c.userIntent.length).toBeGreaterThan(40);
      expect(c.expectedInputStyle.length).toBeGreaterThan(20);
      expect(c.inputRole.length).toBeGreaterThan(30);
      expect(c.memoryRole.length).toBeGreaterThan(30);
    }
  });

  it("includes all downstream signal tokens for each channel", () => {
    for (const ch of ["diary", "twin_chat"] as const) {
      const sigs = TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels[ch].downstreamSignals;
      expect(sigs).toHaveLength(DOWNSTREAM_TOKENS.length);
      for (let i = 0; i < DOWNSTREAM_TOKENS.length; i += 1) {
        const tok = DOWNSTREAM_TOKENS[i];
        expect(sigs[i]?.startsWith(`${tok}:`)).toBe(true);
      }
    }
  });

  it("getTwinMemoryChannelContract returns null for unknown ids", () => {
    expect(getTwinMemoryChannelContract("twin")).toBeNull();
    expect(getTwinMemoryChannelContract("society")).toBeNull();
    expect(getTwinMemoryChannelContract("predictions")).toBeNull();
    expect(getTwinMemoryChannelContract("")).toBeNull();
  });

  it("getTwinMemoryChannelContract returns frozen channel copy", () => {
    const c = getTwinMemoryChannelContract("diary");
    expect(c).toEqual(TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels.diary);
    expect(c?.purpose.length).toBeGreaterThan(32);
  });

  it("lists channels in diary then twin_chat order", () => {
    const rows = listTwinMemoryChannelContracts();
    expect(rows.map((r) => r.channel)).toEqual(["diary", "twin_chat"]);
    expect(rows).toHaveLength(2);
  });

  it("classifies deterministically on repeat calls", () => {
    const payload = { channel: "twin_chat" as TwinMemoryChannelId, text: "What should I focus on tomorrow?" };
    const a = classifyTwinMemoryInput(payload);
    const b = classifyTwinMemoryInput(payload);
    expect(a).toEqual(b);
  });

  it("classifies chat-like questions as question in twin_chat", () => {
    const r = classifyTwinMemoryInput({
      channel: "twin_chat",
      text: "What should I focus on tomorrow?",
    });
    expect(r.kind).toBe("question");
    expect(r.channel).toBe("twin_chat");
  });

  it("classifies diary-like lived experience as reflection, event, or emotional_state", () => {
    const r = classifyTwinMemoryInput({
      channel: "diary",
      text: "Today I went to the office and felt drained.",
    });
    expect(["reflection", "event", "emotional_state"]).toContain(r.kind);
  });

  it("does not embed forbidden clinical needles in bundle text or classifier reasons", () => {
    const bundleText = collectBundleText(TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE).join("\n");
    expect(containsClinicalNeedle(bundleText.toLowerCase())).toBe(false);

    const sampleReasons: TwinMemoryChannelId[] = ["diary", "twin_chat"];
    const samples = [
      "",
      "hello",
      "I want to rest.",
      "I avoided the call.",
      "But actually I lied earlier.",
      "What?",
      "Today I cried.",
      "Could I postpone?",
      "Should I postpone?",
      "Maybe I noticed I tense up.",
    ];
    const reasons = new Set<string>();
    for (const ch of sampleReasons) {
      for (const s of samples) {
        reasons.add(classifyTwinMemoryInput({ channel: ch, text: s }).reason);
      }
    }
    expect([...reasons].some((line) => containsClinicalNeedle(line.toLowerCase()))).toBe(false);
  });
});
