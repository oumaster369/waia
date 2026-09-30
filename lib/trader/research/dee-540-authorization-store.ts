import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ResearchOrchestratorError } from "@/lib/trader/research/errors";

export function defaultDee540ConsumptionPath(): string {
  const configured = process.env.WAIA_DEE540_CONSUMPTION_PATH?.trim();
  return configured && configured.length > 0 ? configured : "var/waia/dee540-consumed.jsonl";
}

/**
 * One-shot consume of a content-bound DEE-540 authorization digest.
 * A second consume of the same digest is refused. The store is a new
 * append-only file, not a lock on a hot table. Fails closed if the file
 * cannot be read or written.
 */
export function consumeDee540BlindTailAuthorization(input: {
  authorizationDigest: string;
  storePath: string;
}): void {
  const digest = input.authorizationDigest.trim();
  if (!digest) {
    throw new ResearchOrchestratorError(
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
      "authorization digest is empty",
    );
  }
  let existing = "";
  try {
    mkdirSync(dirname(input.storePath), { recursive: true });
    try {
      writeFileSync(input.storePath, "", { flag: "wx" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
    }
    existing = readFileSync(input.storePath, "utf8");
  } catch (error) {
    if (error instanceof ResearchOrchestratorError) throw error;
    throw new ResearchOrchestratorError(
      "DEE540_AUTHORIZATION_STORE_UNAVAILABLE",
      error instanceof Error ? error.message : "authorization store unavailable",
    );
  }
  const used = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  if (used.has(digest)) {
    throw new ResearchOrchestratorError(
      "DEE540_AUTHORIZATION_ALREADY_CONSUMED",
      "this blind-tail authorization was already consumed",
    );
  }
  try {
    appendFileSync(input.storePath, `${digest}\n`, "utf8");
  } catch (error) {
    throw new ResearchOrchestratorError(
      "DEE540_AUTHORIZATION_STORE_UNAVAILABLE",
      error instanceof Error ? error.message : "authorization store unavailable",
    );
  }
}
