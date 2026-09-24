export function formatAdminMoney(amount: string, currency: string): string {
  const negative = amount.startsWith("-");
  const body = negative ? amount.slice(1) : amount;
  const [whole = "0", fraction] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  const shown = fraction ? `${grouped},${fraction}` : grouped;
  return `${negative ? "−" : ""}${shown}\u00a0${currency}`;
}
