export type CollectorTask = {
  key: string;
  run: () => Promise<void>;
};

export function collectorsEnabled(env: {
  WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED?: string;
}): boolean {
  const value = env.WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED?.trim().toLowerCase() ?? "";
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function runAdminConsoleCollectorCycle(input: {
  env: { WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED?: string };
  tasks: readonly CollectorTask[];
  onError?: (key: string, error: unknown) => Promise<void>;
  log?: (message: string) => void;
}): Promise<{ ran: string[]; failed: string[] }> {
  if (!collectorsEnabled(input.env)) {
    input.log?.("disabled");
    return { ran: [], failed: [] };
  }
  const ran: string[] = [];
  const failed: string[] = [];
  for (const task of input.tasks) {
    try {
      await task.run();
      ran.push(task.key);
    } catch (error) {
      failed.push(task.key);
      await input.onError?.(task.key, error);
    }
  }
  return { ran, failed };
}
