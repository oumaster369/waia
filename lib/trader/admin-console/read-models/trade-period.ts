export function tradePeriodBounds(input: {
  period: "today" | "7d" | "30d" | "90d" | "custom";
  from?: string;
  to?: string;
  now: Date;
}): { start: string; end: string } {
  if (input.period === "custom") {
    return {
      start: input.from ?? input.now.toISOString(),
      end: input.to ?? input.now.toISOString(),
    };
  }
  const end = input.now.toISOString();
  if (input.period === "today") {
    const start = new Date(
      Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()),
    );
    return { start: start.toISOString(), end };
  }
  const days = input.period === "7d" ? 7 : input.period === "30d" ? 30 : 90;
  return { start: new Date(input.now.getTime() - days * 86_400_000).toISOString(), end };
}
