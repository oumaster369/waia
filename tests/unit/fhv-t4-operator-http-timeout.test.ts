import { describe, expect, it, vi } from "vitest";

import {
  FhvT4OperatorCliError,
  resolveFhvT4OperatorHttpTimeoutMs,
  signedFhvT4ObserverFetch,
  type FhvT4OperatorCliConfig,
} from "@/scripts/trader/fhv-t4-operator-cli";

const baseConfig: FhvT4OperatorCliConfig = {
  subcommand: "status",
  runRoot: "/tmp/run",
  runId: "fhv-timeout",
  organizationId: "00000000-0000-4000-8000-000000000436",
  targetSha: "dddddddddddddddddddddddddddddddddddddddd",
  commandSecret: "command-secret",
  observerTunnelSecret: "tunnel-secret",
  operatorId: "t4-operator",
  observerHost: "127.0.0.1",
  observerPort: 9471,
  repoRoot: "/tmp/repo",
};

describe("fhv-t4-operator HTTP timeout (DEE-436)", () => {
  it("resolves stable default timeout", () => {
    expect(resolveFhvT4OperatorHttpTimeoutMs(process.env)).toBe(10_000);
    expect(
      resolveFhvT4OperatorHttpTimeoutMs({
        ...process.env,
        FHV_T4_OPERATOR_HTTP_TIMEOUT_MS: "2500",
      }),
    ).toBe(2500);
  });

  it("classifies AbortError as FHV_T4_OPERATOR_HTTP_TIMEOUT without retry", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    await expect(
      signedFhvT4ObserverFetch(
        baseConfig,
        { method: "GET", path: "/v1/status" },
        { fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({
      name: "FhvT4OperatorCliError",
      code: "FHV_T4_OPERATOR_HTTP_TIMEOUT",
    } satisfies Partial<FhvT4OperatorCliError>);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
