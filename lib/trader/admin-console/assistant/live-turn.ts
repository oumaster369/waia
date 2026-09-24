import { tokensFromUsage, type AssistantUsage } from "@/lib/trader/admin-console/assistant/budget";
import {
  citationIdsInToolPayload,
  numbersInToolPayload,
} from "@/lib/trader/admin-console/assistant/segments";
import {
  runAssistantTurn,
  type AssistantAnswer,
} from "@/lib/trader/admin-console/assistant/run-assistant";

export async function runLiveAssistantTurn(input: {
  content: string;
  toolText: string;
  complete: (prompt: string) => Promise<{ text: string; usage?: { totalTokens?: number } }>;
}): Promise<
  | { status: "answer"; answer: AssistantAnswer; usage: AssistantUsage }
  | { status: "failed"; message: "Не удалось разобрать ответ модели"; usage: AssistantUsage }
  | { status: "stopped"; usage: AssistantUsage }
> {
  let tokens = 0;
  let estimated = false;
  const turn = await runAssistantTurn({
    knownCitations: citationIdsInToolPayload(input.toolText),
    factRefs: numbersInToolPayload(input.toolText).map((value) => ({ value })),
    complete: async (prompt) => {
      const result = await input.complete(`${prompt}\n${input.toolText}\n${input.content}`);
      const counted = tokensFromUsage(result.usage ?? null, result.text);
      tokens += counted.tokens;
      estimated = estimated || counted.estimated;
      return result.text;
    },
  });
  const usage = { tokens, estimated };
  if (turn.status === "answer") return { status: "answer", answer: turn.answer, usage };
  if (turn.status === "stopped") return { status: "stopped", usage };
  return { status: "failed", message: turn.message, usage };
}
