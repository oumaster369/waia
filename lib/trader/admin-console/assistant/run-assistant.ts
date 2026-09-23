import {
  factSegmentMatches,
  UNVERIFIED_SEGMENT,
} from "@/lib/trader/admin-console/assistant/segments";

export type AssistantAnswer = {
  summary: string;
  citations: string[];
  unverified: boolean;
};

export async function runAssistantTurn(input: {
  complete: (prompt: string) => Promise<string>;
  knownCitations: readonly string[];
  factRefs: readonly { value: string }[];
}): Promise<
  | { status: "answer"; answer: AssistantAnswer }
  | { status: "failed"; message: "Не удалось разобрать ответ модели" }
  | { status: "stopped" }
> {
  let raw: string;
  try {
    raw = await input.complete("admin-assistant/v1");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "stopped" };
    throw error;
  }
  let parsed = readAnswer(raw);
  if (!parsed) {
    try {
      parsed = readAnswer(await input.complete("repair"));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { status: "stopped" };
      return { status: "failed", message: "Не удалось разобрать ответ модели" };
    }
  }
  if (!parsed) return { status: "failed", message: "Не удалось разобрать ответ модели" };
  const citations = parsed.citations.filter((id) => input.knownCitations.includes(id));
  const unverified = !factSegmentMatches(parsed.summary, input.factRefs);
  return {
    status: "answer",
    answer: {
      summary: unverified ? UNVERIFIED_SEGMENT : parsed.summary,
      citations,
      unverified,
    },
  };
}

function readAnswer(raw: string): { summary: string; citations: string[] } | null {
  try {
    const body = JSON.parse(raw) as { action?: string; summary?: string; citations?: unknown };
    if (
      body.action !== "answer" ||
      typeof body.summary !== "string" ||
      !Array.isArray(body.citations)
    ) {
      return null;
    }
    if (!body.citations.every((item) => typeof item === "string")) return null;
    return { summary: body.summary, citations: body.citations };
  } catch {
    return null;
  }
}
