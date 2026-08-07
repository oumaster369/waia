import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  clearIdhpsHotPathBans,
  setIdhpsHotPathEnabled,
} from "@/lib/trader/execution/idhps-hot-path-counters";
import { closeIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";

afterEach(() => {
  cleanup();
  // IDHPS session/bans are process-global; always clear so later files are not fail-closed.
  try {
    closeIdhpsSession();
  } catch {
    // ignore — still force-clear below
  }
  setIdhpsHotPathEnabled(false);
  clearIdhpsHotPathBans();
});
