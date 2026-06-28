/** Probe BP-6 execution host health endpoint (fail-closed when unset/unhealthy). */
export async function probeExecutionHostHealth(
  env: Record<string, unknown> = process.env,
): Promise<boolean> {
  const raw = env.WAIA_TRADER_EXECUTION_HOST_URL;
  const baseUrl = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  if (!baseUrl) {
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { status?: string; service?: string };
    return body.status === "ok" && body.service === "ai-trader-execution-host";
  } catch {
    return false;
  }
}
