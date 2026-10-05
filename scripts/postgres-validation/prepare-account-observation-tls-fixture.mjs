import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Only an explicitly identified disposable PostgreSQL service with synthetic credentials.
// This helper never reads production URLs or credentials and never downloads a certificate.
const container = process.argv[2];
if (!/^[0-9a-f]{12,64}$/.test(container ?? "")) throw new Error("Synthetic container ID required");
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
const [metadata] = JSON.parse(run("docker", ["inspect", container]));
const expectedEnv = ["POSTGRES_USER=waia_local_admin", "POSTGRES_PASSWORD=local_validation_only", "POSTGRES_DB=waia_dee960_local"];
if (metadata.Config.Image !== "postgres:17-alpine" || !metadata.State.Running ||
  !expectedEnv.every(value => metadata.Config.Env.includes(value)) ||
  !metadata.NetworkSettings.Ports["5432/tcp"]?.length) throw new Error("Unexpected synthetic PostgreSQL service");

const fixtureName = process.argv[3] ?? "account-observation-tls";
if (!/^account-observation-[a-z-]+$/.test(fixtureName)) throw new Error("Synthetic fixture name required");
const directory = resolve(".tmp", fixtureName);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = name => resolve(directory, name);
writeFileSync(file("ca.cnf"), `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=WAIA disposable observation TLS test CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n`, { mode: 0o600 });
writeFileSync(file("server.cnf"), `[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=127.0.0.1\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n`, { mode: 0o600 });
try {
  run("openssl", ["req", "-new", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "2", "-config", file("ca.cnf"), "-keyout", file("ca.key"), "-out", file("ca.crt")]);
  run("openssl", ["req", "-new", "-nodes", "-newkey", "rsa:2048", "-config", file("server.cnf"), "-keyout", file("server.key"), "-out", file("server.csr")]);
  run("openssl", ["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.crt"), "-CAkey", file("ca.key"), "-CAserial", file("ca.srl"), "-CAcreateserial", "-days", "2", "-extfile", file("server.cnf"), "-extensions", "server", "-out", file("server.crt")]);
  run("docker", ["exec", container, "mkdir", "-p", "/tmp/waia-observation-tls"]);
  for (const name of ["server.crt", "server.key"]) run("docker", ["cp", file(name), `${container}:/tmp/waia-observation-tls/${name}`]);
  run("docker", ["exec", container, "chown", "-R", "postgres:postgres", "/tmp/waia-observation-tls"]);
  run("docker", ["exec", container, "chmod", "0600", "/tmp/waia-observation-tls/server.key"]);
  for (const sql of [
    "ALTER SYSTEM SET ssl_cert_file = '/tmp/waia-observation-tls/server.crt'",
    "ALTER SYSTEM SET ssl_key_file = '/tmp/waia-observation-tls/server.key'",
    "ALTER SYSTEM SET ssl = 'on'",
  ]) run("docker", ["exec", container, "psql", "-U", "waia_local_admin", "-d", "waia_dee960_local", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  run("docker", ["restart", container]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { run("docker", ["exec", container, "pg_isready", "-U", "waia_local_admin", "-d", "waia_dee960_local"]); ready = true; break; }
    catch { await new Promise(resolveWait => setTimeout(resolveWait, 300)); }
  }
  if (!ready) throw new Error("Synthetic TLS PostgreSQL not ready");
  console.log(JSON.stringify({ synthetic: true, tls: true, caFingerprint: new X509Certificate(readFileSync(file("ca.crt"))).fingerprint256 }));
} finally {
  for (const name of ["ca.key", "ca.srl", "ca.cnf", "server.key", "server.csr", "server.cnf"]) rmSync(file(name), { force: true });
}
