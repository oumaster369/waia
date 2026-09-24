/** Local seed may open only a loopback Postgres named by the operator. */
export function assertAdminConsoleSeedLocal(env: NodeJS.ProcessEnv): URL {
  if (env.WAIA_ADMIN_CONSOLE_SEED_LOCAL !== "1") {
    throw new Error("SEED_REFUSED:WAIA_ADMIN_CONSOLE_SEED_LOCAL");
  }
  const raw = env.DATABASE_URL_POSTGRES?.trim();
  if (!raw) throw new Error("SEED_REFUSED:DATABASE_URL_POSTGRES");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SEED_REFUSED:DATABASE_URL_POSTGRES");
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("SEED_REFUSED:HOST");
  }
  return url;
}
