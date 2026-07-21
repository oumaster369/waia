import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHealthBody,
  createHealthServer,
} from "../../services/ai-trader-execution-host/server.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SERVICES_DIR = path.join(REPO_ROOT, "services");
const EXECUTION_HOST_DIR = path.join(SERVICES_DIR, "ai-trader-execution-host");
const SERVER_SOURCE = path.join(EXECUTION_HOST_DIR, "server.mjs");
const WRANGLER_PATH = path.join(REPO_ROOT, "wrangler.jsonc");

describe("BP-6 execution host health (DEE-339)", () => {
  it("returns ok health payload", () => {
    expect(buildHealthBody()).toEqual({
      status: "ok",
      service: "ai-trader-execution-host",
    });
  });

  it("serves GET /health with JSON body", async () => {
    const { server, port } = createHealthServer({ port: 0 });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(buildHealthBody());

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    expect(port).toBe(0);
  });
});

describe("BP-6 architecture boundaries (DEE-339 ratification)", () => {
  it("allows only approved host services under services/", () => {
    const entries = readdirSync(SERVICES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(entries).toEqual(["ai-trader-execution-host", "ai-trader-fhv-observer"]);
  });

  it("keeps execution host free of Cloudflare Worker imports", () => {
    const source = readFileSync(SERVER_SOURCE, "utf8");

    expect(source).not.toMatch(/getCloudflareContext|@opennextjs\/cloudflare|wrangler/);
    expect(source).not.toMatch(/AI_TRADER_MASTER_KEY/);
  });

  it("does not commit docker-compose or orchestration manifests in execution host", () => {
    const files = readdirSync(EXECUTION_HOST_DIR);
    expect(files.some((name) => name.includes("compose"))).toBe(false);
    expect(files.some((name) => name.endsWith(".yaml") || name.endsWith(".yml"))).toBe(false);
  });

  it("allows only approved Secrets Store binding on Worker (BP-9A Step 2)", () => {
    const wrangler = readFileSync(WRANGLER_PATH, "utf8");

    // Dev-only master key material must never ship in wrangler.jsonc.
    expect(wrangler).not.toMatch(/AI_TRADER_MASTER_KEY_DEV/);

    // Option B: execution plane URL and host-only secrets stay off the Worker config.
    expect(wrangler).not.toMatch(/WAIA_TRADER_EXECUTION_HOST_URL/);
    expect(wrangler).not.toMatch(/EXECUTION_HOST.*KMS|HOST_KMS|host-only secret/i);

    // BP-9A Step 2: canonical Secrets Store binding for HTX credential crypto readiness.
    expect(wrangler).toMatch(/^\s*"secrets_store_secrets":\s*\[/m);

    const secretsStoreMatch = wrangler.match(/"secrets_store_secrets":\s*\[([\s\S]*?)\n\s*\]/);
    expect(secretsStoreMatch).not.toBeNull();
    const secretsStoreBlock = secretsStoreMatch![1]!;

    const bindings = [...secretsStoreBlock.matchAll(/"binding":\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(bindings).toEqual(["AI_TRADER_MASTER_KEY"]);

    // Metadata only — no secret values, tokens, or raw credentials in the store block.
    expect(secretsStoreBlock).toMatch(/"store_id":\s*"/);
    expect(secretsStoreBlock).toMatch(/"secret_name":\s*"ai-trader-master-key-v1"/);
    expect(secretsStoreBlock).not.toMatch(
      /TELEGRAM|TRONGRID|TRON_RPC|api[_-]?secret|private[_-]?key|seed phrase|Bearer /i,
    );

    // Worker plain env must not embed operator Wrangler secrets (names in docs only).
    expect(wrangler).not.toMatch(/TELEGRAM_ALERTS_BOT_TOKEN\s*:/);
    expect(wrangler).not.toMatch(/TRONGRID_API_KEY\s*:/);
  });
});
