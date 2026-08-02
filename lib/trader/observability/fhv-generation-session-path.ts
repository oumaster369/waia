import { join } from "node:path";

/** Per-fencing-generation isolated research replay SQLite path under a FHV run directory. */
export function resolveFhvGenerationSessionDbPath(
  runDir: string,
  fencingGeneration: number,
): string {
  return join(runDir, "sessions", `generation-${fencingGeneration}`, "research-replay.sqlite");
}
