import { createHash } from "node:crypto";
import { types } from "node:util";

export type ExpectedScientificCheckpointV1 = {
  releaseSha: string;
  runtime: { node: string; os: string; arch: string };
  stage: string;
  kind: "evidence" | "package";
  input: unknown;
};
const fail = (): never => { throw new Error("SCIENTIFIC_CHECKPOINT_KEY_REFUSED"); };

/** Diagnostic mirror of the unchanged v1 store's identity encoding, with explicit
 * original runtime rather than the auditor's runtime. No cache factory, IO, build,
 * input mutation or admission. Callers must independently establish input provenance.
 * Parity tests against directories actually published by the v1 store prevent drift.
 * Reject accessors/cycles/exotic objects rather than executing caller-provided code.
 */
export function deriveScientificCheckpointKeyV1(expected: ExpectedScientificCheckpointV1): string {
  const dataObject = (value: unknown, fields: string[]) => {
    if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length || Object.keys(value).sort().join(",") !== fields.sort().join(",")) fail();
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor)) fail();
    }
  };
  dataObject(expected, ["releaseSha", "runtime", "stage", "kind", "input"]);
  dataObject(expected.runtime, ["node", "os", "arch"]);
  for (const value of [expected.releaseSha, expected.stage, expected.kind,
    expected.runtime.node, expected.runtime.os, expected.runtime.arch])
    if (typeof value !== "string") fail();
  if (!/^[a-f0-9]{40}$/.test(expected.releaseSha) ||
      !/^[a-z0-9-]+$/.test(expected.stage) ||
      !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(expected.runtime.node) ||
      !/^[a-z0-9_]+$/.test(expected.runtime.os) || !/^[a-z0-9_]+$/.test(expected.runtime.arch) ||
      (expected.kind !== "evidence" && expected.kind !== "package") ||
      (expected.kind === "package") !== (expected.stage === "predictive-package")) fail();
  const hash = createHash("sha256"), ancestors = new Set<object>();
  function visit(value: unknown, depth = 0): void {
    if (depth > 128) fail();
    if (value !== null && typeof value === "object" && types.isProxy(value)) fail();
    if (Buffer.isBuffer(value)) {
      if (Object.getPrototypeOf(value) !== Buffer.prototype || Object.getOwnPropertyDescriptor(value, "length")) fail();
      hash.update(`buffer:${value.length}:`).update(value); return;
    }
    if (value !== null && typeof value === "object") {
      if (ancestors.has(value)) fail();
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length ||
              Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail();
          hash.update(`array:${value.length}[`);
          for (let i = 0; i < value.length; i++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
            if (descriptor && !("value" in descriptor)) fail();
            // An inherited element is not an ordinary sparse-array undefined value.
            if (!descriptor && i in value) fail();
            visit(descriptor?.value, depth + 1);
          }
          hash.update("]"); return;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail();
        if (Object.getOwnPropertySymbols(value).length) fail();
        const keys = Object.keys(value).sort(); hash.update(`object:${keys.length}{`);
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !("value" in descriptor)) return fail();
          visit(key, depth + 1); visit(descriptor.value, depth + 1);
        }
        hash.update("}"); return;
      } finally { ancestors.delete(value); }
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail();
      const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value);
      hash.update("number:").update(bytes); return;
    }
    if (typeof value === "string") {
      const bytes = Buffer.from(value); hash.update(`string:${bytes.length}:`).update(bytes); return;
    }
    if (value === null || value === undefined || typeof value === "boolean") {
      hash.update(`${typeof value}:${String(value)};`); return;
    }
    fail();
  }
  visit({ format: "waia-scientific-checkpoint/v1", releaseSha: expected.releaseSha,
    runtime: { node: expected.runtime.node, os: expected.runtime.os, arch: expected.runtime.arch },
    stage: expected.stage, input: expected.input });
  return hash.digest("hex");
}
