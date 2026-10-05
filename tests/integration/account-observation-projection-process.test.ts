import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import postgres, { type Sql } from "postgres";
import { createAccountObservationDatabaseTlsOptions } from "@/lib/trader/account-observation/database-node-tls";
import { createProjectionRequest, verifyProjectionRequest, verifyProjectionResponse,
  type ProjectionPayload, type SignedProjectionRequest, type ProjectionTuple } from "@/lib/trader/account-observation/projection-protocol";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";

// Explicit disposable fixture receipt only. No production URL or environment fallback.
const fixturePath = process.env.WAIA_PROJECTION_NATIVE_FIXTURE;
const image = process.env.WAIA_PROJECTION_NATIVE_IMAGE;
const enabled = Boolean(fixturePath && image);
const execute = promisify(execFile);
const docker = async (...args: string[]) => (await execute("docker", args, { timeout: 45000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const clientProgram = `
import http from 'node:http';
let raw=''; for await (const part of process.stdin) raw+=part;
const {request,abortAfterMs}=JSON.parse(raw);
await new Promise(resolve=>{
 const q=http.request({socketPath:'/run/waia-observation-projection/http.sock',method:'POST',path:request.path,
  headers:{'content-type':'application/json','content-length':Buffer.byteLength(request.body),...Object.fromEntries(request.headers)}},r=>{
  let body='';r.setEncoding('utf8');r.on('data',c=>body+=c);r.on('end',()=>{
   console.log(JSON.stringify({status:r.statusCode,body,headers:[['x-waia-projection-signature',r.headers['x-waia-projection-signature']||'']]})); resolve();
  });
 });
 q.on('error',()=>{console.log(JSON.stringify({aborted:true}));resolve()});
 if(abortAfterMs) setTimeout(()=>q.destroy(),abortAfterMs);
 q.setTimeout(6000,()=>q.destroy());q.end(request.body);
});`;

describe.skipIf(!enabled)("actual locked projection child with owned canonical PG17 fixture", () => {
  let receipt: { owner: string; network: { name: string; id: string; internal: boolean }; container: { id: string; name: string; hostPort: number };
    runtimeConfig: { path: string; readerUrlPath: string; hmacKeyPath: string; caPath: string }; adminUrlPath: string;
    seeds: { primary: { binding: ObservationBinding; observationId: string }; secondary: { binding: ObservationBinding } } };
  let tuple: ProjectionTuple, key: Buffer, admin: Sql, pinnedImage: string;
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const service = `waia-projection-test-service-${token}`;
  const secretVolume = `waia-projection-test-secrets-${token}`;
  const runtimeVolume = `waia-projection-test-runtime-${token}`;
  const containers = new Map<string, string>(); const volumes = new Set<string>();
  const label = "waia.fixture.owner=codex-projection-process";
  const tokenLabel = `waia.fixture.token=${token}`;
  const owns = (labels: Record<string, string> | undefined) => labels?.["waia.fixture.owner"] === "codex-projection-process"
    && labels?.["waia.fixture.token"] === token;
  async function recordContainer(name: string, id: string) {
    const metadata = JSON.parse(await docker("inspect", id))[0];
    if (!/^[0-9a-f]{64}$/.test(id) || metadata.Id !== id || !owns(metadata.Config.Labels)) throw new Error("TEST_CONTAINER_OWNERSHIP_REFUSED");
    containers.set(name, id);
  }

  async function until(check: () => Promise<boolean>, timeout = 18000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await wait(50); }
    throw new Error("SYNTHETIC_PROJECTION_CONDITION_TIMEOUT");
  }
  async function readerSessions() {
    return admin`SELECT a.pid,a.state,a.xact_start,a.wait_event_type,s.ssl FROM pg_stat_activity a
      LEFT JOIN pg_stat_ssl s ON a.pid=s.pid
      WHERE a.usename='waia_account_observation_reader_login' ORDER BY a.pid`;
  }
  async function ready() { await until(async () => (await docker("logs", service)).includes('"event":"READY"')); }
  async function request(payload: ProjectionPayload, operation: "resolveBinding" | "readLatest" = "readLatest") {
    const issuedAtMs = Date.now();
    return createProjectionRequest({ operation, tuple, requestId: randomUUID(), issuedAtMs,
      deadlineMs: issuedAtMs + 4900, payload }, key);
  }
  function send(req: SignedProjectionRequest, abortAfterMs?: number) {
    return new Promise<{ status?: number; body?: string; headers?: string[][]; aborted?: boolean }>((resolve, reject) => {
      const child = execFile("docker", ["exec", "-i", "--user", "10001:10001", service,
        "node", "--input-type=module", "-e", clientProgram], { timeout: 9000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => { if (error) reject(new Error("SYNTHETIC_UNIX_CLIENT_FAILED"));
        else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("SYNTHETIC_UNIX_CLIENT_OUTPUT_FAILED")); } } });
      child.stdin!.end(JSON.stringify({ request: req, abortAfterMs }));
    });
  }
  async function signedRead(binding: ObservationBinding) {
    const req = await request(binding); const raw = await send(req);
    expect(raw.status).toBe(200);
    const verified = await verifyProjectionRequest(req, { expectedTuple: tuple, keyBytes: key });
    return verifyProjectionResponse(raw, verified, { expectedTuple: tuple, keyBytes: key });
  }
  async function launch(name: string, extra: string[] = []) {
    const id = await docker("run", "-d", "--pull=never", "--name", name, "--label", label, "--label", tokenLabel,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--memory", "384m", "--cpus", "0.5", "--network", receipt.network.name,
      "--mount", `type=volume,source=${runtimeVolume},target=/run/waia-observation-projection`,
      "--mount", `type=volume,source=${secretVolume},target=/run/secrets/waia-projection,readonly`, ...extra, pinnedImage);
    await recordContainer(name, id);
    expect(JSON.parse(await docker("inspect", name))[0].Image).toBe(pinnedImage);
  }

  beforeAll(async () => {
    for (const variable of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
      if (process.env[variable]) throw new Error("LOCAL_DOCKER_CONTEXT_REQUIRED");
    }
    const endpoint = await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}");
    if (!endpoint.startsWith("unix:///")) throw new Error("LOCAL_DOCKER_SOCKET_REQUIRED");
    receipt = JSON.parse(readFileSync(fixturePath!, "utf8"));
    pinnedImage = JSON.parse(await docker("image", "inspect", image!))[0].Id;
    if (!/^sha256:[0-9a-f]{64}$/.test(pinnedImage)) throw new Error("EXACT_IMAGE_REQUIRED");
    const localManifest = JSON.parse(readFileSync(".tmp/projection/dependency-manifest.json", "utf8"));
    const imageManifest = JSON.parse(await docker("run", "--rm", "--network", "none", "--read-only",
      "--entrypoint", "/bin/cat", pinnedImage, "/app/dependency-manifest.json"));
    expect(imageManifest).toEqual(localManifest);
    const imageBundleHash = await docker("run", "--rm", "--network", "none", "--read-only",
      "--entrypoint", "/usr/bin/sha256sum", pinnedImage, "/app/account-observation-projection-host.mjs");
    expect(imageBundleHash.split(" ")[0]).toBe(localManifest.bundleSha256);
    if (receipt.owner !== "codex-projection-native" ||
        !receipt.container.name.startsWith("waia-projection-native-pg17-")) throw new Error("OWNED_FIXTURE_REQUIRED");
    const metadata = JSON.parse(await docker("inspect", receipt.container.id))[0];
    expect(metadata.Config.Labels["waia.fixture.owner"]).toBe("codex-projection-native");
    const network = JSON.parse(await docker("network", "inspect", receipt.network.name))[0];
    expect(network.Id).toBe(receipt.network.id);
    expect(network.Internal).toBe(receipt.network.internal);
    expect(network.Labels["waia.fixture.owner"]).toBe("codex-projection-native");
    expect(network.Labels["waia.fixture.token"]).toBe(metadata.Config.Labels["waia.fixture.token"]);
    expect(metadata.NetworkSettings.Networks[receipt.network.name].NetworkID).toBe(network.Id);
    expect(metadata.NetworkSettings.Ports["5432/tcp"]).toEqual([
      { HostIp: "127.0.0.1", HostPort: String(receipt.container.hostPort) },
    ]);
    tuple = JSON.parse(readFileSync(receipt.runtimeConfig.path, "utf8")).tuple;
    key = Buffer.from(readFileSync(receipt.runtimeConfig.hmacKeyPath, "utf8").trim(), "hex");
    const adminUrl = readFileSync(receipt.adminUrlPath, "utf8").trim();
    if (new URL(adminUrl).hostname !== "127.0.0.1" ||
        Number(new URL(adminUrl).port) !== receipt.container.hostPort) throw new Error("LOCAL_ADMIN_ONLY");
    admin = postgres(adminUrl, { max: 2, prepare: false, connect_timeout: 3, onnotice: () => {},
      ssl: createAccountObservationDatabaseTlsOptions(readFileSync(receipt.runtimeConfig.caPath, "utf8")) });
    for (const volume of [secretVolume, runtimeVolume]) {
      expect((await docker("volume", "ls", "--format", "{{.Name}}")).split("\n")).not.toContain(volume);
      await docker("volume", "create", "--label", label, "--label", tokenLabel, volume);
      if (!owns(JSON.parse(await docker("volume", "inspect", volume))[0].Labels)) throw new Error("TEST_VOLUME_OWNERSHIP_REFUSED");
      volumes.add(volume);
    }
    const initializer = `waia-projection-test-init-${token}`;
    const initializerId = await docker("create", "--name", initializer, "--label", label, "--label", tokenLabel, "--network", "none", "--user", "0:0",
      "--entrypoint", "/bin/sh", "--mount", `type=volume,source=${runtimeVolume},target=/runtime`,
      "--mount", `type=volume,source=${secretVolume},target=/secrets`, pinnedImage, "-c",
      "chown -R 10001:10001 /runtime /secrets; chmod 2750 /runtime; chmod 0700 /secrets; chmod 0600 /secrets/*");
    await recordContainer(initializer, initializerId);
    for (const [path, name] of [[receipt.runtimeConfig.path, "config.json"], [receipt.runtimeConfig.readerUrlPath, "reader-url"],
      [receipt.runtimeConfig.hmacKeyPath, "hmac-key"], [receipt.runtimeConfig.caPath, "test-ca.crt"]]) {
      await docker("cp", path, `${initializer}:/secrets/${name}`);
    }
    await docker("start", "-a", initializer);
    await launch(service);
  }, 60000);

  afterAll(async () => {
    // Only resources created by this exact test token; fixture PG belongs to root handoff.
    const unremoved: string[] = [];
    for (const [name, id] of containers) {
      try {
        const metadata = JSON.parse(await docker("inspect", id))[0];
        if (metadata.Id !== id || !owns(metadata.Config.Labels)) throw new Error("OWNERSHIP_CHANGED");
      } catch { unremoved.push(name); continue; }
      try { await docker("stop", "--time", "12", id); } catch { /* already stopped */ }
      await docker("rm", "-f", "-v", id).catch(() => {});
      try {
        const remaining = (await docker("ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}")).split("\n");
        if (remaining.includes(name)) unremoved.push(name);
      } catch { unremoved.push(name); }
    }
    for (const volume of volumes) {
      try {
        if (!owns(JSON.parse(await docker("volume", "inspect", volume))[0].Labels)) throw new Error("OWNERSHIP_CHANGED");
      } catch { unremoved.push(volume); continue; }
      await docker("volume", "rm", volume).catch(() => {});
      try {
        const remaining = (await docker("volume", "ls", "--filter", `name=${volume}`, "--format", "{{.Name}}")).split("\n");
        if (remaining.includes(volume)) unremoved.push(volume);
      } catch { unremoved.push(volume); }
    }
    key?.fill(0); await admin?.end();
    expect(unremoved, "Owned native test resources must be verifiably removed").toEqual([]);
  }, 60000);

  it("holds a real inherited Linux flock, quarantines startup, and owns one encrypted restricted session", async () => {
    await until(async () => (await docker("logs", service)).includes('"event":"QUARANTINE"'));
    const raw = await send(await request(receipt.seeds.primary.binding));
    expect(raw.status).toBe(503);
    const info = await docker("exec", service, "sh", "-c", "cat /proc/1/fdinfo/9; stat -c '%a' /run/waia-observation-projection/http.sock");
    expect(info).toMatch(/FLOCK\s+ADVISORY\s+WRITE/); expect(info).toMatch(/660$/);
    await ready();
    const sessions = await readerSessions(); expect(sessions).toHaveLength(1); expect(sessions[0].ssl).toBe(true);
  }, 25000);

  it("returns actual signed database payload and refuses replay or mismatched tenant identity", async () => {
    const req = await request(receipt.seeds.primary.binding);
    const raw = await send(req); expect(raw.status).toBe(200);
    const verified = await verifyProjectionRequest(req, { expectedTuple: tuple, keyBytes: key });
    const data = await verifyProjectionResponse(raw, verified, { expectedTuple: tuple, keyBytes: key });
    expect(data).toMatchObject({ observationId: receipt.seeds.primary.observationId, binding: receipt.seeds.primary.binding });
    expect((await send(req)).status).toBe(503);
    expect(await signedRead({ ...receipt.seeds.primary.binding,
      organizationId: receipt.seeds.secondary.binding.organizationId })).toBeNull();
  });

  it("refuses a simultaneous process before any second pool or socket replacement", async () => {
    const second = `waia-projection-test-second-${token}`;
    const before = await readerSessions();
    await launch(second);
    await until(async () => (await docker("inspect", "--format", "{{.State.Running}}", second)) === "false");
    const exit = Number(await docker("inspect", "--format", "{{.State.ExitCode}}", second));
    expect(exit).toBe(75);
    expect((await execute("docker", ["logs", second])).stderr.trim()).toBe("ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE");
    expect((await readerSessions()).map(row => row.pid)).toEqual(before.map(row => row.pid));
    expect(await signedRead(receipt.seeds.primary.binding)).toMatchObject({ observationId: receipt.seeds.primary.observationId });
  });

  it("retains the active transaction after client abort, then cleans scope before the next request", async () => {
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const done = new Promise<void>(resolve => { release = resolve; });
    const lock = admin.begin(async tx => {
      await tx`LOCK TABLE public.trader_account_observations IN ACCESS EXCLUSIVE MODE`;
      acquired(); await done;
    });
    await held;
    try {
      const reading = send(await request(receipt.seeds.primary.binding), 350);
      await until(async () => (await readerSessions()).some(row => row.wait_event_type === "Lock"), 3000);
      expect(await reading).toEqual({ aborted: true });
      expect((await readerSessions()).some(row => row.xact_start !== null)).toBe(true);
      const binding = receipt.seeds.primary.binding;
      const next = await send(await request({ organizationId: binding.organizationId,
        credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId }, "resolveBinding"));
      expect(next.status).toBe(200);
      await until(async () => (await readerSessions()).every(row => row.state === "idle" && row.xact_start === null));
    } finally { release(); await lock; }
    expect(await signedRead(receipt.seeds.primary.binding)).toMatchObject({ observationId: receipt.seeds.primary.observationId });
  }, 15000);

  it("drains on SIGTERM, releases its session and lock, then re-quarantines the same tuple on restart", async () => {
    await docker("kill", "--signal", "TERM", service);
    await until(async () => (await docker("inspect", "--format", "{{.State.Running}}", service)) === "false");
    expect(await readerSessions()).toHaveLength(0);
    expect(await docker("inspect", "--format", "{{.State.ExitCode}}", service)).toBe("0");
    const preRestart = await request(receipt.seeds.primary.binding);
    const oldReadyCount = (await docker("logs", service)).split('"event":"READY"').length;
    const oldQuarantineCount = (await docker("logs", service)).split('"event":"QUARANTINE"').length;
    await docker("start", service);
    await until(async () => (await docker("logs", service)).split('"event":"QUARANTINE"').length > oldQuarantineCount);
    expect((await send(preRestart)).status).toBe(503);
    await until(async () => (await docker("logs", service)).split('"event":"READY"').length > oldReadyCount);
    expect((await send(preRestart)).status).toBe(503);
    expect(await signedRead(receipt.seeds.primary.binding)).toMatchObject({ observationId: receipt.seeds.primary.observationId });
  }, 25000);

  it("survives abrupt process loss with a fresh boot quarantine and rejects pre-crash requests", async () => {
    const oldRequest = await request(receipt.seeds.primary.binding);
    const oldReadyCount = (await docker("logs", service)).split('"event":"READY"').length;
    const oldQuarantineCount = (await docker("logs", service)).split('"event":"QUARANTINE"').length;
    await docker("kill", "--signal", "KILL", service); // Own synthetic service only, never a DB backend.
    await until(async () => (await readerSessions()).length === 0);
    await docker("start", service);
    await until(async () => (await docker("logs", service)).split('"event":"QUARANTINE"').length > oldQuarantineCount);
    expect((await send(oldRequest)).status).toBe(503);
    await until(async () => (await docker("logs", service)).split('"event":"READY"').length > oldReadyCount);
    expect((await send(oldRequest)).status).toBe(503);
    expect(await signedRead(receipt.seeds.primary.binding)).toMatchObject({ observationId: receipt.seeds.primary.observationId });
  }, 25000);

  it("keeps the lock and refuses replacement work when the actual database transport is stuck", async () => {
    const oldUnreadyCount = (await docker("logs", service)).split('"event":"UNREADY"').length;
    // Only this suite's explicitly labelled disposable database is paused. Restored in finally.
    await docker("pause", receipt.container.id);
    try {
      expect((await send(await request(receipt.seeds.primary.binding))).status).toBe(503);
      await until(async () => (await docker("logs", service)).split('"event":"UNREADY"').length > oldUnreadyCount, 10000);
      expect(await docker("inspect", "--format", "{{.State.Running}}", service)).toBe("true");
      expect((await send(await request(receipt.seeds.primary.binding))).status).toBe(503);
    } finally { await docker("unpause", receipt.container.id); }
    await until(async () => (await readerSessions()).every(row => row.state === "idle" && row.xact_start === null));
    expect(await readerSessions()).toHaveLength(1);
    // Poison remains latched after transport recovery; no automatic new pool/reconnect/reset.
    expect((await send(await request(receipt.seeds.primary.binding))).status).toBe(503);
  }, 25000);
});
