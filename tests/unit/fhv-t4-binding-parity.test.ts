import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertFhvT4aBindingParity,
  FHV_T4A_OPERATOR_BINDING_ENV_NAMES,
  resolveFhvT4aOperatorBindingEnvNames,
  resolveFhvT4aPacketBindingExportNames,
} from "@/lib/trader/observability/fhv-t4a-binding-parity";

describe("fhv-t4a-binding-parity", () => {
  it("exports canonical operator env names including FHV_SYSTEMD_ANALYZE_BIN", () => {
    const names = resolveFhvT4aOperatorBindingEnvNames();
    expect(names).toContain("FHV_SYSTEMD_ANALYZE_BIN");
    expect(names).toEqual(FHV_T4A_OPERATOR_BINDING_ENV_NAMES);
  });

  it("assertFhvT4aBindingParity passes on published packet exports", () => {
    const packet = readFileSync(join(process.cwd(), "docs/ops/T4_OPERATOR_PACKET_V5.md"), "utf8");
    expect(() => assertFhvT4aBindingParity(packet)).not.toThrow();
  });

  it("assertFhvT4aBindingParity fails when required export missing", () => {
    expect(() => assertFhvT4aBindingParity("export EXEC_HOST=x\n")).toThrow(
      /FHV_T4A_BINDING_PARITY_GAP|SSH_USER|required binding/,
    );
  });

  it("packet export list includes post-rollback host probe path", () => {
    expect(resolveFhvT4aPacketBindingExportNames()).toContain("FHV_POST_ROLLBACK_HOST_PROBE_PATH");
  });
});
