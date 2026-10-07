import "server-only";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { z } from "zod";

export const PROJECTION_RUNTIME_DIRECTORY = "/run/waia-observation-projection";
export const PROJECTION_SECRET_DIRECTORY = "/run/secrets/waia-projection";
export const PROJECTION_READER_LOGIN = "waia_account_observation_reader_login";
export const PROJECTION_DATABASE_POOL = Object.freeze({
  max: 1, connect_timeout: 3, max_lifetime: 300, idle_timeout: 20, prepare: false as const,
});

const schema = z.object({
  version: z.literal(1),
  deployment: z.enum(["production", "isolated-test"]),
  tuple: z.object({
    audience: z.literal("https://observation-reader.waia.life"),
    releaseSha: z.string().regex(/^[0-9a-f]{40}$/),
    epochId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  }).strict(),
  databaseHost: z.string(),
  databasePort: z.number().int().min(1).max(65535),
  databaseName: z.string(),
}).strict();
export type ProjectionServiceConfig = Readonly<z.infer<typeof schema>>;
const fail = (): never => { throw new Error("PROJECTION_SERVICE_CONFIG_REFUSED"); };

/** No environment/URL options may override the separately pinned endpoint or pool. */
export function parseProjectionServiceConfig(input: unknown): ProjectionServiceConfig {
  try {
    const config = schema.parse(input);
    if (config.deployment === "production") {
      if (config.databaseHost !== "db.wdsnuvldxyrkqcjxvuxp.supabase.co" ||
          config.databasePort !== 5432 || config.databaseName !== "postgres") fail();
    } else if (!["waia-projection-test-db", "127.0.0.1", "localhost"].includes(config.databaseHost) ||
        config.databaseName !== "waia_projection_test") fail();
    Object.freeze(config.tuple);
    return Object.freeze(config);
  } catch { return fail(); }
}

export function parseProjectionDatabaseCredentials(value: string, config: ProjectionServiceConfig) {
  try {
    const uri = new URL(value);
    if (!["postgres:", "postgresql:"].includes(uri.protocol) || uri.search || uri.hash ||
        uri.hostname !== config.databaseHost || Number(uri.port || "5432") !== config.databasePort ||
        decodeURIComponent(uri.pathname) !== `/${config.databaseName}` ||
        decodeURIComponent(uri.username) !== PROJECTION_READER_LOGIN || !uri.password) fail();
    return Object.freeze({ host: config.databaseHost, port: config.databasePort,
      database: config.databaseName, username: PROJECTION_READER_LOGIN,
      password: decodeURIComponent(uri.password) });
  } catch { return fail(); }
}

/** The launcher's inherited open-file-description lock is observable on this exact
 * FD in Linux fdinfo. A pathname, PID file or environment flag alone is not a lock.
 * The stable lock inode is never removed, including on clean shutdown. */
export function assertProjectionLifetimeLock(): void {
  try {
    const uid = process.getuid?.();
    if (process.platform !== "linux" || uid === undefined || uid === 0) fail();
    if (realpathSync(PROJECTION_RUNTIME_DIRECTORY) !== PROJECTION_RUNTIME_DIRECTORY) fail();
    const dir = lstatSync(PROJECTION_RUNTIME_DIRECTORY);
    if (!dir.isDirectory() || dir.uid !== uid || (dir.mode & 0o022) !== 0) fail();
    const path = `${PROJECTION_RUNTIME_DIRECTORY}/lifetime.lock`;
    const file = lstatSync(path);
    const fd = fstatSync(9);
    if (!file.isFile() || !fd.isFile() || file.dev !== fd.dev || file.ino !== fd.ino ||
        fd.uid !== uid || fd.nlink !== 1 || (fd.mode & 0o077) !== 0) fail();
    const info = readFileSync("/proc/self/fdinfo/9", "utf8");
    if (!new RegExp(`^lock:\\s+\\d+: FLOCK\\s+ADVISORY\\s+WRITE\\s+\\d+ [0-9a-f]+:[0-9a-f]+:${fd.ino} 0 EOF$`, "m").test(info)) fail();
  } catch { fail(); }
}

/** Read bounded, nonsymlink mount files, never CLI args or ambient fallback vars. */
export function readProjectionMountFile(name: "config.json" | "reader-url" | "hmac-key" | "test-ca.crt"): Buffer {
  let fd: number | undefined;
  try {
    if (realpathSync(PROJECTION_SECRET_DIRECTORY) !== PROJECTION_SECRET_DIRECTORY) fail();
    const dir = lstatSync(PROJECTION_SECRET_DIRECTORY);
    if (!dir.isDirectory() || (dir.mode & 0o022) !== 0 ||
        ![0, process.getuid?.()].includes(dir.uid)) fail();
    fd = openSync(`${PROJECTION_SECRET_DIRECTORY}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    const sensitive = name === "reader-url" || name === "hmac-key";
    if (!stat.isFile() || stat.nlink !== 1 || ![0, process.getuid?.()].includes(stat.uid) ||
        (stat.mode & (sensitive ? 0o077 : 0o022)) !== 0 || stat.size < 1 || stat.size > 16384) fail();
    const data = Buffer.alloc(16385);
    let length = 0;
    while (length < data.byteLength) {
      const count = readSync(fd, data, length, data.byteLength - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 16384) { data.fill(0); fail(); }
    return data.subarray(0, length);
  } catch { return fail(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
