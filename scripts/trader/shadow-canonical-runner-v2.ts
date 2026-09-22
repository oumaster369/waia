import { createFileShadowCycleStore } from "@/lib/trader/runtime-v2/shadow-cycle-file-journal-v2";
import { runShadowRunnerCliV2 } from "@/lib/trader/runtime-v2/shadow-canonical-runner-v2";

const code = await runShadowRunnerCliV2(process.argv.slice(2), createFileShadowCycleStore);
process.exit(code);
