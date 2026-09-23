/**
 * Exchange prices stay decimal strings. A missing or non-decimal field is null,
 * never a substituted zero.
 */

export function decimalText(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (raw === "" || raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return null;
  const plain = /^-?\d+(\.\d+)?$/.test(raw) ? raw : expandScientific(raw);
  if (!plain) return null;
  const negative = plain.startsWith("-");
  const unsigned = negative ? plain.slice(1) : plain;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  if (whole === "0" && fraction === "") return "0";
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

function expandScientific(raw: string): string | null {
  const match = /^(-?)(\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(raw);
  if (!match) return null;
  const sign = match[1] ?? "";
  const digits = match[2] ?? "";
  const exponent = Number(match[3]);
  if (!Number.isSafeInteger(exponent)) return null;
  const [whole, fraction = ""] = digits.split(".");
  const combined = `${whole}${fraction}`;
  const point = whole.length + exponent;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${combined}`.replace(/0+$/, "");
  if (point >= combined.length) return `${sign}${combined}${"0".repeat(point - combined.length)}`;
  return `${sign}${combined.slice(0, point)}.${combined.slice(point)}`.replace(/0+$/, "");
}
