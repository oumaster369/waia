import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { requireApplication as check, APPLICATION_LIMITS, captureApplicationConfigurationV1 } from "./contract";
import { captureResearchReplaySelector } from "../research-understanding-v1/held-replay";
import { LIMITS } from "../research-understanding-v1/contract";
import type { SavedApplicationRequest } from "./repository-postgres";

export async function parseSavedApplicationOptions(supplied: readonly string[]): Promise<SavedApplicationRequest> {
  const args = [...supplied], flags = new Map<string, string>();
  check(args.filter(v => v === "--saved-research-application").length === 1, "APPLICATION_FLAGS_INVALID");
  const allowed = new Set(["application-file", "operation", "previous-sequence", "current-sequence", "consumer-sequence"]);
  for (const arg of args) {
    if (arg === "--" || arg === "--saved-research-application") continue;
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    check(match && allowed.has(match[1]!) && !flags.has(match[1]!), "APPLICATION_FLAGS_INVALID"); flags.set(match[1]!, match[2]!);
  }
  check(["application-file", "operation", "previous-sequence", "current-sequence"].every(k => flags.has(k)), "APPLICATION_FLAGS_INVALID");
  const operation = flags.get("operation"); check(operation === "apply" || operation === "consume" || operation === "replay", "APPLICATION_FLAGS_INVALID");
  check((operation !== "consume" || flags.has("consumer-sequence")) && (operation !== "apply" || !flags.has("consumer-sequence")), "APPLICATION_FLAGS_INVALID");
  const number = (key: string) => { const value = flags.get(key)!; check(/^(0|[1-9][0-9]*)$/.test(value), "APPLICATION_FLAGS_INVALID");
    const n = Number(value); check(Number.isSafeInteger(n), "APPLICATION_FLAGS_INVALID"); return n; };
  const previousSourceSequence = number("previous-sequence"), currentSourceSequence = number("current-sequence");
  const consumerSourceSequence = flags.has("consumer-sequence") ? number("consumer-sequence") : undefined;
  check(currentSourceSequence === previousSourceSequence + 1 && (consumerSourceSequence === undefined || consumerSourceSequence > currentSourceSequence), "APPLICATION_FLAGS_INVALID");
  const file = flags.get("application-file")!;
  check(file.trim() === file && file.length > 0 && Buffer.byteLength(file) <= LIMITS.text, "APPLICATION_FLAGS_INVALID");
  const maximum = APPLICATION_LIMITS.assignment + LIMITS.assignment + LIMITS.profile;
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat(); check(stat.isFile() && stat.size <= maximum, "APPLICATION_FILE_LIMIT");
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length <= maximum) { const read = await handle.read(buffer, length, buffer.length - length, length); length += read.bytesRead; if (!read.bytesRead) break; }
    check(length <= maximum, "APPLICATION_FILE_LIMIT");
    let value: unknown; try { value = JSON.parse(buffer.subarray(0, length).toString("utf8")); } catch { check(false, "APPLICATION_FILE_INVALID"); }
    check(value !== null && typeof value === "object" && !Array.isArray(value), "APPLICATION_FILE_INVALID");
    check(Object.keys(value).length === 2 && "configuration" in value && "research" in value, "APPLICATION_FILE_INVALID");
    const configuration = captureApplicationConfigurationV1(value.configuration);
    // Data capture validates old assignment/profile selectors without deriving an actor from a file.
    const research = value.research as SavedApplicationRequest["research"];
    captureResearchReplaySelector({ organizationId: configuration.organizationId }, research);
    return { configuration, research: structuredClone(research), operation, previousSourceSequence, currentSourceSequence,
      ...(consumerSourceSequence === undefined ? {} : { consumerSourceSequence }) };
  } finally { await handle.close(); }
}
