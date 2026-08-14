import {
  formatOptionalUsdFromMicros,
  formatUsdFromMicros,
} from "@/lib/treasury-admin/money-format";
import { classifyMoneyFact } from "@/lib/treasury-admin/facts";

export function MoneyText({
  micros,
  empty = "Not provided",
}: {
  micros: string | null | undefined;
  empty?: string;
}) {
  const kind = classifyMoneyFact(micros);
  if (kind === "null") {
    return (
      <span data-testid="money-null" className="text-muted-foreground">
        {empty}
      </span>
    );
  }
  if (kind === "zero") {
    return (
      <span data-testid="money-zero" className="font-mono tabular-nums">
        {formatUsdFromMicros("0")}
      </span>
    );
  }
  const formatted = formatOptionalUsdFromMicros(micros);
  const negative = micros!.startsWith("-");
  return (
    <span
      data-testid={negative ? "money-negative" : "money-value"}
      className="font-mono tabular-nums"
    >
      {formatted}
    </span>
  );
}
