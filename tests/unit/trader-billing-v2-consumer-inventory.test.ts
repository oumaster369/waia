import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BILLING_V2_MODULE_ROOT,
  billingV2SourceHasForbiddenVenueWrite,
} from "@/lib/trader/billing/v2";

function walkTs(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTs(full));
      continue;
    }
    if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("DEE-638 billing V2 consumer inventory", () => {
  it("detects execution/live/connector placeOrder imports and keeps billing V2 free of them", () => {
    expect(
      billingV2SourceHasForbiddenVenueWrite(
        'import { dispatch } from "@/lib/trader/execution/v2/connector-dispatch";',
      ),
    ).toBe(true);
    expect(
      billingV2SourceHasForbiddenVenueWrite('import x from "@/lib/trader/live/run-live-cycle";'),
    ).toBe(true);
    expect(billingV2SourceHasForbiddenVenueWrite("connector.placeOrder({}).then(() => {});")).toBe(
      true,
    );

    const root = resolve(process.cwd(), BILLING_V2_MODULE_ROOT);
    const hits: string[] = [];
    for (const file of walkTs(root)) {
      const source = readFileSync(file, "utf8");
      if (billingV2SourceHasForbiddenVenueWrite(source)) {
        hits.push(relative(process.cwd(), file));
      }
    }
    expect(hits).toEqual([]);
  });
});
