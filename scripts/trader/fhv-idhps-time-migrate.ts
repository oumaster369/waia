import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  applyResearchReplaySqlitePragmas,
  getDb,
  getRawSqliteDatabase,
  resetWaiaSqliteSingleton,
} from "@/db/client";
import { closeIdhpsSession, openIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
const dbPath = path.join(tempDir, "t.sqlite");
process.env.DATABASE_URL = dbPath;
closeIdhpsSession();
resetWaiaSqliteSingleton();
const t0 = performance.now();
const db = getDb();
migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
applyResearchReplaySqlitePragmas(getRawSqliteDatabase());
openIdhpsSession(getRawSqliteDatabase(), { enableBans: false });
console.log(
  JSON.stringify({
    migrateMs: performance.now() - t0,
    dbPath,
  }),
);
