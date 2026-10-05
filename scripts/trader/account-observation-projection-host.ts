/** Fixed, reader-only Linux service entry. No ambient DB/env/HTX fallback. */
import { lstatSync, readFileSync } from "node:fs";
import { assertProjectionLifetimeLock, parseProjectionServiceConfig,
  readProjectionMountFile } from "../../lib/trader/account-observation/projection-service-config";
import { runProjectionService } from "../../lib/trader/account-observation/projection-service";

async function main() {
  assertProjectionLifetimeLock();
  if (process.argv.length !== 2) throw new Error("PROJECTION_SERVICE_REFUSED");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const config = parseProjectionServiceConfig(JSON.parse(readProjectionMountFile("config.json").toString("utf8")));
  const releaseFile = lstatSync("/app/release-sha");
  if (!releaseFile.isFile() || releaseFile.uid !== 0 || (releaseFile.mode & 0o022) !== 0 ||
      releaseFile.size > 41 || readFileSync("/app/release-sha", "utf8").trim() !== config.tuple.releaseSha) {
    throw new Error("PROJECTION_SERVICE_REFUSED");
  }
  const urlBuffer = readProjectionMountFile("reader-url");
  const keyBuffer = readProjectionMountFile("hmac-key");
  let key: Buffer | undefined;
  try {
    const keyHex = keyBuffer.toString("utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("PROJECTION_SERVICE_REFUSED");
    key = Buffer.from(keyHex, "hex");
    const databaseUrl = urlBuffer.toString("utf8").trim();
    urlBuffer.fill(0); keyBuffer.fill(0);
    const certificateAuthority = config.deployment === "isolated-test"
      ? readProjectionMountFile("test-ca.crt").toString("utf8") : undefined;
    await runProjectionService({ config, databaseUrl, hmacKey: key, certificateAuthority,
      signal: controller.signal,
      report: event => process.stdout.write(JSON.stringify({ service: "waia-account-observation-projection",
        event, releaseSha: config.tuple.releaseSha, epochId: config.tuple.epochId }) + "\n") });
  } finally {
    urlBuffer.fill(0); keyBuffer.fill(0); key?.fill(0);
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
  }
}

void main().catch(() => {
  process.stderr.write("PROJECTION_SERVICE_REFUSED\n");
  process.exitCode = 1;
});
