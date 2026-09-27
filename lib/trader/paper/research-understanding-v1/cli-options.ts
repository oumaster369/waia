import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { check, LIMITS, captureAssignmentConfig, captureProfileDefinition, parseStrict, rangeSchema, digestSchema } from "./contract";
import type { ResearchRequest } from "./repository-postgres";

/** Bound bytes before parsing and again while reading; filenames are never authority. */
async function readConfig(path: string, maximum: number): Promise<unknown> {
  check(path.length > 0 && path === path.trim() && Buffer.byteLength(path) <= LIMITS.text, "INVALID_CONFIG_PATH");
  // A FIFO must not block before the regular-file/size check can run.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const metadata = await handle.stat();
    check(metadata.isFile() && metadata.size <= maximum, "CONFIG_FILE_LIMIT_EXCEEDED");
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length <= maximum) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      length += result.bytesRead; if (!result.bytesRead) break;
    }
    check(length <= maximum, "CONFIG_FILE_LIMIT_EXCEEDED");
    try { return JSON.parse(buffer.subarray(0, length).toString("utf8")); }
    catch (error) { if (error instanceof SyntaxError) throw new Error("INVALID_CONFIG_JSON"); throw error; }
  } finally { await handle.close(); }
}
export async function parseSavedResearchOptions(args: readonly string[]): Promise<ResearchRequest> {
  const flags = new Map<string, string>();
  const allowed = new Set(["assignment-file", "profile-file", "profile-id", "profile-digest", "start-sequence", "count", "lease-duration-ms"]);
  check(args.filter(a => a === "--saved-research-understanding").length === 1, "INVALID_RESEARCH_FLAGS");
  for (const arg of args) {
    if (arg === "--" || arg === "--saved-research-understanding") continue;
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    check(match && allowed.has(match[1]!) && !flags.has(match[1]!), "INVALID_RESEARCH_FLAGS"); flags.set(match[1]!, match[2]!);
  }
  const fromFile = flags.has("profile-file");
  const required = ["assignment-file", "start-sequence", "count", "lease-duration-ms", ...(fromFile ? ["profile-file"] : ["profile-id", "profile-digest"])];
  check(flags.size === required.length && required.every(k => flags.has(k)), "INVALID_RESEARCH_FLAGS");
  const number = (name: string) => { const text = flags.get(name)!; check(/^(0|[1-9][0-9]*)$/.test(text), "INVALID_RESEARCH_FLAGS"); return Number(text); };
  const range = parseStrict(rangeSchema, { startSequence: number("start-sequence"), count: number("count"), leaseDurationMs: number("lease-duration-ms") }, "INVALID_RANGE");
  // Capture every flag before the first await; caller mutation cannot change scope midway.
  const assignmentPath = flags.get("assignment-file")!; const profilePath = flags.get("profile-file");
  const id = flags.get("profile-id"); const contentDigest = flags.get("profile-digest");
  const assignment = captureAssignmentConfig(await readConfig(assignmentPath, LIMITS.assignment));
  if (fromFile) {
    const definition = await readConfig(profilePath!, LIMITS.profile); captureProfileDefinition(definition);
    return { assignment, range, profile: { definition } };
  }
  return { assignment, range, profile: { id: parseStrict(digestSchema, id, "INVALID_PROFILE_SELECTOR"),
    contentDigest: parseStrict(digestSchema, contentDigest, "INVALID_PROFILE_SELECTOR") } };
}
