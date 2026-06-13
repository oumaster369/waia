import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseEnvFileContent,
  resolveDatabaseUrlPostgresForKit,
} from "@/drizzle/load-postgres-env-for-kit";

describe("drizzle postgres env loader", () => {
  it("parses quoted values and ignores comments", () => {
    expect(
      parseEnvFileContent(`
# comment
DATABASE_URL_POSTGRES="postgresql://u:p@host:6543/db"
`),
    ).toEqual({ DATABASE_URL_POSTGRES: "postgresql://u:p@host:6543/db" });
  });

  it("prefers exported shell value over env files", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "waia-drizzle-env-"));
    try {
      writeFileSync(
        path.join(cwd, ".env.local"),
        "DATABASE_URL_POSTGRES=postgresql://from-file:5432/db\n",
      );
      expect(
        resolveDatabaseUrlPostgresForKit({
          cwd,
          shellValue: "postgresql://from-shell:5432/db",
        }),
      ).toBe("postgresql://from-shell:5432/db");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("loads DATABASE_URL_POSTGRES from .env.local when shell is unset", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "waia-drizzle-env-"));
    try {
      writeFileSync(
        path.join(cwd, ".env.local"),
        "DATABASE_URL_POSTGRES=postgresql://pooler:6543/postgres\n",
      );
      expect(resolveDatabaseUrlPostgresForKit({ cwd, shellValue: undefined })).toBe(
        "postgresql://pooler:6543/postgres",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("lets .env.local override .env", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "waia-drizzle-env-"));
    try {
      writeFileSync(path.join(cwd, ".env"), "DATABASE_URL_POSTGRES=postgresql://base:5432/db\n");
      writeFileSync(
        path.join(cwd, ".env.local"),
        "DATABASE_URL_POSTGRES=postgresql://local:6543/db\n",
      );
      expect(resolveDatabaseUrlPostgresForKit({ cwd, shellValue: undefined })).toBe(
        "postgresql://local:6543/db",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("throws when DATABASE_URL_POSTGRES is missing everywhere", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "waia-drizzle-env-"));
    try {
      expect(() => resolveDatabaseUrlPostgresForKit({ cwd, shellValue: undefined })).toThrow(
        /DATABASE_URL_POSTGRES is not set/,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
