import { runExecutionRealityDeliveryCli } from "@/lib/trader/reality/v2/execution-report-delivery-cli";

void runExecutionRealityDeliveryCli().catch(() => { process.exitCode = 1; });
