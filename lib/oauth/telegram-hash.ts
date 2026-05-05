import { createHash, createHmac } from "node:crypto";

/**
 * Validates Telegram Login redirect parameters per
 * https://core.telegram.org/widgets/login#checking-authorization
 */

const MAX_AUTH_AGE_SEC = 86400;

function buildTelegramDataCheckString(params: Record<string, string>): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === "hash") continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("\n");
}

/** Secret key = SHA256(bot_token) UTF-8 bytes — used as HMAC key over data_check_string (UTF-8). */
export function verifyTelegramLoginWidgetHash(botToken: string, queryParams: Record<string, string>): boolean {
  const hashHex = queryParams.hash?.toLowerCase();
  const id = queryParams.id;
  const authDate = queryParams.auth_date;
  if (!hashHex || !id || !authDate) {
    return false;
  }

  const ts = Number.parseInt(authDate, 10);
  if (!Number.isFinite(ts)) {
    return false;
  }
  if (Date.now() / 1000 - ts > MAX_AUTH_AGE_SEC) {
    return false;
  }

  const dataCheck = buildTelegramDataCheckString(queryParams);
  const secretKey = createHash("sha256").update(botToken, "utf8").digest();
  const hmacHex = createHmac("sha256", secretKey).update(dataCheck, "utf8").digest("hex");
  return hmacHex === hashHex;
}

export function telegramIdentityLabel(params: Record<string, string>): string {
  const name = params.first_name?.trim() || "";
  const un = params.username?.trim();
  if (name) return name;
  if (un) return un;
  return "User";
}
