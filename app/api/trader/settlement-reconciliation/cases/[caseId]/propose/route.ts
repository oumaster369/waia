import { NextResponse } from "next/server";

import {
  createProductionReconciliationWorkflowHandlerDeps,
  handleReconciliationWorkflowCommand,
} from "@/lib/trader/settlement/reconciliation/reconciliation-workflow-handler";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { caseId } = await context.params;
  const result = await handleReconciliationWorkflowCommand(
    caseId,
    "propose",
    request,
    createProductionReconciliationWorkflowHandlerDeps(),
  );
  return NextResponse.json(result.body, { status: result.status });
}
