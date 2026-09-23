export function wrapToolResult(tool: string, text: string): string {
  const clipped = text.slice(0, 500);
  return `<tool_result tool="${tool}" trust="data">${clipped}</tool_result>`;
}

export function assistantEnabled(env: { WAIA_ADMIN_ASSISTANT_ENABLED?: string }): boolean {
  return ["1", "true", "yes", "on"].includes(
    (env.WAIA_ADMIN_ASSISTANT_ENABLED ?? "").toLowerCase(),
  );
}
