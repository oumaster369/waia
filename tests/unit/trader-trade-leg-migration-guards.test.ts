import { readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("DEE-635 trade-leg upgrade guards", () => {
  it("aborts the SQLite upgrade when a legacy fill belongs to another order", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE trader_orders (id TEXT NOT NULL, organization_id TEXT NOT NULL, UNIQUE(id, organization_id));
      CREATE TABLE trader_trades (id TEXT NOT NULL, organization_id TEXT NOT NULL, UNIQUE(id, organization_id));
      CREATE TABLE trader_position_lots (id TEXT NOT NULL, organization_id TEXT NOT NULL, UNIQUE(id, organization_id));
      CREATE TABLE trader_fills (id TEXT NOT NULL, organization_id TEXT NOT NULL, order_id TEXT NOT NULL);
      CREATE TABLE trader_trade_legs (
        id TEXT NOT NULL, organization_id TEXT NOT NULL, trade_id TEXT NOT NULL,
        position_lot_id TEXT NOT NULL, kind TEXT NOT NULL, order_id TEXT NOT NULL,
        fill_id TEXT, synthetic_id TEXT, quantity TEXT NOT NULL, price TEXT NOT NULL,
        fee TEXT NOT NULL, executed_at INTEGER NOT NULL, leg_pnl TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO trader_fills VALUES ('fill-1', 'org-1', 'order-actual');
      INSERT INTO trader_trade_legs VALUES (
        'leg-1', 'org-1', 'trade-1', 'lot-1', 'OPEN', 'order-invented',
        'fill-1', NULL, '1', '100', '0', 1, '0', 1
      );
    `);

    const migration = readFileSync(
      join(root, "db/migrations/0044_dee635_trade_leg_reference_guards.sql"),
      "utf8",
    );
    const statements = migration.split("--> statement-breakpoint").map((sql) => sql.trim()).filter(Boolean);

    expect(() => {
      for (const statement of statements) db.exec(statement);
    }).toThrow(/TRADE_LEG_LEGACY_REFERENCE_INVALID/);
  });

  it("validates PostgreSQL legacy rows before relaxing or adding constraints", () => {
    const migration = readFileSync(
      join(root, "db/migrations_postgres/0180_dee635_trade_leg_reference_guards.sql"),
      "utf8",
    );
    const validation = migration.indexOf("TRADE_LEG_LEGACY_REFERENCE_INVALID");
    const alteration = migration.indexOf("ALTER TABLE trader_trade_legs ALTER COLUMN");

    expect(validation).toBeGreaterThanOrEqual(0);
    expect(validation).toBeLessThan(alteration);
    expect(migration).toContain("fill.order_id <> leg.order_id");
    expect(migration).toContain("leg.kind = 'FORCED_FLAT'");
  });
});
