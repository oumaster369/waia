import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyRemoteFsPrivilegeLocus,
  buildRemoteFsReadCommand,
  FhvT4aRemoteFsOpsError,
  parseRemoteFsReadStdout,
  parseRemoteFsSha256Stdout,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-ops";

const PYTHON_BIN = process.env.FHV_TEST_PYTHON_BIN?.trim() || "/usr/bin/python3";

describe("fhv-t4 remote fs ops (DEE-436 F-03)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("applyRemoteFsPrivilegeLocus wraps SSH_USER, REMOTE_ROOT, and SERVICE_USER", () => {
    expect(applyRemoteFsPrivilegeLocus("echo ok", { locus: "SSH_USER" })).toBe("echo ok");
    expect(applyRemoteFsPrivilegeLocus("echo ok", { locus: "REMOTE_ROOT" })).toBe(
      "sudo -n echo ok",
    );
    expect(
      applyRemoteFsPrivilegeLocus("echo ok", {
        locus: "SERVICE_USER",
        serviceUser: "fhv",
      }),
    ).toBe("sudo -n runuser -u 'fhv' -- echo ok");
  });

  it("rejects double sudo for REMOTE_ROOT and SERVICE_USER", () => {
    try {
      applyRemoteFsPrivilegeLocus("sudo -n echo ok", { locus: "REMOTE_ROOT" });
      expect.unreachable("REMOTE_ROOT double sudo should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_DOUBLE_SUDO");
    }
    try {
      applyRemoteFsPrivilegeLocus("sudo -n echo ok", {
        locus: "SERVICE_USER",
        serviceUser: "fhv",
      });
      expect.unreachable("SERVICE_USER double sudo should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_DOUBLE_SUDO");
    }
  });

  it("requires serviceUser for SERVICE_USER locus", () => {
    try {
      applyRemoteFsPrivilegeLocus("echo ok", { locus: "SERVICE_USER" });
      expect.unreachable("missing serviceUser should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_PRIVILEGE_LOCUS_MISSING");
    }
  });

  it("buildRemoteFsReadCommand includes python payload and privilege wrapper", () => {
    const command = buildRemoteFsReadCommand({
      remotePath: "/remote/artifacts/proof.json",
      approvedRoots: ["/remote/artifacts"],
      locus: "REMOTE_ROOT",
      pythonBin: PYTHON_BIN,
      byteCap: 4096,
    });
    expect(command).toMatch(/^sudo -n/);
    expect(command).toContain(PYTHON_BIN);
    expect(command).toContain("remotePath");
    expect(command).toContain("byteCap");
  });

  it("parseRemoteFsReadStdout validates bytes, digest, and byte cap", () => {
    const bytes = '{"ok":true}';
    const sha256 = createHash("sha256").update(bytes, "utf8").digest("hex");
    expect(
      parseRemoteFsReadStdout(JSON.stringify({ bytes, sha256, size: bytes.length }), 4096),
    ).toEqual({
      bytes,
      sha256,
      size: bytes.length,
    });

    try {
      parseRemoteFsReadStdout("not-json", 4096);
      expect.unreachable("malformed read stdout should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_MALFORMED_RESPONSE");
    }
    try {
      parseRemoteFsReadStdout(JSON.stringify({ bytes, sha256: "bad", size: bytes.length }), 4096);
      expect.unreachable("bad digest should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_MALFORMED_DIGEST");
    }
    try {
      parseRemoteFsReadStdout(JSON.stringify({ error: "BYTE_CAP_EXCEEDED" }), 4096);
      expect.unreachable("read error payload should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_READ_FAILED");
    }

    const oversized = "x".repeat(5000);
    const oversizedDigest = createHash("sha256").update(oversized, "utf8").digest("hex");
    try {
      parseRemoteFsReadStdout(
        JSON.stringify({ bytes: oversized, sha256: oversizedDigest, size: oversized.length }),
        4096,
      );
      expect.unreachable("byte cap should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_BYTE_CAP_EXCEEDED");
    }
  });

  it("parseRemoteFsSha256Stdout rejects malformed digest responses", () => {
    expect(parseRemoteFsSha256Stdout(JSON.stringify({ sha256: "a".repeat(64), size: 1 }))).toBe(
      "a".repeat(64),
    );
    try {
      parseRemoteFsSha256Stdout("{");
      expect.unreachable("malformed sha256 stdout should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_MALFORMED_RESPONSE");
    }
    try {
      parseRemoteFsSha256Stdout(JSON.stringify({ sha256: "not-a-digest" }));
      expect.unreachable("bad sha256 digest should fail");
    } catch (error) {
      expect((error as FhvT4aRemoteFsOpsError).code).toBe("REMOTE_FS_MALFORMED_DIGEST");
    }
  });

  it("python read script rejects symlink escape and parent symlink escape", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-remote-fs-"));
    const approved = join(root, "approved");
    mkdirSync(approved, { recursive: true });
    writeFileSync(join(approved, "good.txt"), "ok");
    symlinkSync(join(approved, "good.txt"), join(approved, "symlink.txt"));
    symlinkSync(approved, join(root, "parent-link"));

    const symlinkCommand = buildRemoteFsReadCommand({
      remotePath: join(approved, "symlink.txt"),
      approvedRoots: [approved],
      locus: "SSH_USER",
      pythonBin: PYTHON_BIN,
      byteCap: 1024,
    });
    const symlinkResult = spawnSync("bash", ["-c", symlinkCommand], { encoding: "utf8" });
    expect(symlinkResult.status).toBe(3);
    expect(symlinkResult.stderr).toMatch(/SYMLINK_ESCAPE/);

    const parentLinkCommand = buildRemoteFsReadCommand({
      remotePath: join(root, "parent-link", "good.txt"),
      approvedRoots: [approved],
      locus: "SSH_USER",
      pythonBin: PYTHON_BIN,
      byteCap: 1024,
    });
    const parentLinkResult = spawnSync("bash", ["-c", parentLinkCommand], { encoding: "utf8" });
    expect(parentLinkResult.status).toBe(3);
    expect(parentLinkResult.stderr).toMatch(/PARENT_SYMLINK_ESCAPE/);
  });

  it("python read script enforces byte cap for regular files", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-remote-fs-cap-"));
    const approved = join(root, "approved");
    mkdirSync(approved, { recursive: true });
    writeFileSync(join(approved, "large.txt"), "x".repeat(32));

    const command = buildRemoteFsReadCommand({
      remotePath: join(approved, "large.txt"),
      approvedRoots: [approved],
      locus: "SSH_USER",
      pythonBin: PYTHON_BIN,
      byteCap: 16,
    });
    const result = spawnSync("bash", ["-c", command], { encoding: "utf8" });
    expect(result.status).toBe(7);
    expect(result.stderr).toMatch(/BYTE_CAP_EXCEEDED/);
  });

  it("python read script rejects paths outside approved roots", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-remote-fs-outside-"));
    const approved = join(root, "approved");
    const outside = join(root, "outside");
    mkdirSync(approved, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "secret");

    const command = buildRemoteFsReadCommand({
      remotePath: join(outside, "secret.txt"),
      approvedRoots: [approved],
      locus: "SSH_USER",
      pythonBin: PYTHON_BIN,
      byteCap: 1024,
    });
    const result = spawnSync("bash", ["-c", command], { encoding: "utf8" });
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/PATH_OUTSIDE_APPROVED_ROOT/);
  });
});
