import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertCheckpointExecutionState,
  readReplayCheckpoint,
  writeReplayCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { ReplayCheckpointError } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { restoreWp17ExecutionFromCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { createHistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17SqliteSession,
  makeWp17Bar,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 replay-checkpoint-resume harness integration", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("writes and reads executionState through the WP05 checkpoint authority", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.30000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));
    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1.0" }),
    });

    const executionState = session.exchange.buildCheckpointSlice();
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp17-checkpoint-"));
    tempDirs.push(runRoot);

    writeReplayCheckpoint(runRoot, {
      schemaVersion: "htr-wp17-replay-checkpoint/v3",
      backtestRunId: "wp17-harness-test",
      datasetContentDigest: "digest",
      datasetId: "wp17-harness",
      codeSha: "test",
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: 1,
      safeResumeThroughCycleIndex: 0,
      evidenceRunDir: runRoot,
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      executionState,
      checkpointDigest: "",
    });

    const record = readReplayCheckpoint(runRoot);
    expect(record?.executionState?.openOrders).toHaveLength(1);
    expect(record?.executionState?.openOrders[0]?.orderId).toBe(order.id);
    assertCheckpointExecutionState(record!, true);
  });

  it("restores open-order metadata and continues identical partial slices", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.40000000",
    });
    session.exchange.registerOrder(order, 1, Date.parse(makeWp17Bar(1).barCloseTime));
    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "1.0" }),
    });

    const slice = session.exchange.buildCheckpointSlice();
    const resumedProfile = {
      profileId: "htr-historical-execution-profile/v1" as const,
      model: createHistoricalExecutionModelV1(),
      exchange: createHistoricalSimulatedExchange(createHistoricalExecutionModelV1()),
    };

    await restoreWp17ExecutionFromCheckpoint({
      profile: resumedProfile,
      slice,
      orderRepository: session.repo,
      context: session.context,
    });

    await advanceWp17Bar({
      session: { ...session, exchange: resumedProfile.exchange },
      barIndex: 3,
      bar: makeWp17Bar(3, { volume: "1.0" }),
    });

    const fills = await session.repo.listFills(session.context, order.id);
    expect(fills.length).toBeGreaterThanOrEqual(1);
    expect(resumedProfile.exchange.listOpenOrders()[0]?.remainingQty).not.toBe("0.40000000");
  });

  it("fails closed when executionState is missing but open historical orders exist", () => {
    expect(() =>
      assertCheckpointExecutionState(
        {
          schemaVersion: "htr-wp17-replay-checkpoint/v3",
          backtestRunId: "x",
          datasetContentDigest: "d",
          datasetId: "d",
          codeSha: "c",
          activePhase: "validation",
          dbDurableThroughPhase: "none",
          evidenceDurableThroughCycleIndex: 0,
          safeResumeThroughCycleIndex: -1,
          evidenceRunDir: "/tmp",
          evidenceChainDigest: null,
          evidenceTerminalState: "STREAMING_EVIDENCE_FAILED",
          dbConnectionMode: null,
          replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
          checkpointDigest: "00",
        },
        true,
      ),
    ).toThrow(ReplayCheckpointError);
  });
});
