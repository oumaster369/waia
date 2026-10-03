import "server-only";
import { createHash } from "node:crypto";
import type { HtxObservationCredentialHandle } from "../htx-reader-opener";
import { AccountObservationReadFailure } from "../service";
import type { ObservationBinding, ObservationClock, ObservationReadError } from "../types";
import { observationBindingSchema, sameObservationBinding } from "../validation";
import {
  createHtxDerivativesAccountTransport,
  type HtxDerivativesAccountTransport,
} from "./htx-account-transport";
import {
  parseHtxDerivativesAccountSnapshot,
  parseHtxDerivativesFillsPage,
  parseHtxDerivativesPositionsSnapshot,
} from "./parser";
import {
  HTX_DERIVATIVES_ACCOUNT_FAMILIES,
  HTX_DERIVATIVES_FILL_CONTRACT_LIMIT,
  HTX_DERIVATIVES_FILL_LOOKBACK_MS,
  HTX_DERIVATIVES_FILL_MAX_PAGES,
  HTX_DERIVATIVES_FILL_MAX_ROWS,
  isHtxDerivativesFillContract,
  type HtxDerivativesAccountFamily,
  type HtxDerivativesFillContract,
  type HtxDerivativesFillRow,
  type HtxDerivativesPositionRow,
} from "./types";

/** One exact opened key and explicit configuration-bound families. The composition
 * supplies concrete fresh read-only key admission; this reader cannot enroll a
 * family or confer trading authority. The containing spot reader owns the handle. */
export function createHtxDerivativesObservationReader(
  input: Readonly<{
    credential: HtxObservationCredentialHandle;
    families: readonly HtxDerivativesAccountFamily[];
    fillContracts?: readonly HtxDerivativesFillContract[];
    clock: ObservationClock;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxResponseBytes: number;
    verifyReadOnlyAdmission(
      binding: ObservationBinding,
      keyDigest: string,
      signal: AbortSignal,
    ): Promise<boolean>;
  }>,
) {
  const { credential, fetchImpl, timeoutMs, maxResponseBytes, verifyReadOnlyAdmission } = input;
  const binding = Object.freeze(observationBindingSchema.parse(credential.binding));
  const fingerprint = (key: string, secret: string) =>
    createHash("sha256")
      .update(JSON.stringify([key, secret]))
      .digest("hex");
  const openedKeyFingerprint = fingerprint(credential.apiKey, credential.apiSecret);
  if (
    !Array.isArray(input.families) ||
    !input.families.length ||
    input.families.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length ||
    new Set(input.families).size !== input.families.length ||
    input.families.some((family) => !HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)) ||
    typeof verifyReadOnlyAdmission !== "function"
  ) {
    throw new AccountObservationReadFailure("PERMISSION_DENIED");
  }
  const families = Object.freeze([...input.families]);
  const rawFillContracts = input.fillContracts ?? [];
  if (
    !Array.isArray(rawFillContracts) ||
    rawFillContracts.length > HTX_DERIVATIVES_FILL_CONTRACT_LIMIT ||
    new Set(rawFillContracts.map((item) => `${item.family}\u0000${item.contract}`)).size !==
      rawFillContracts.length ||
    rawFillContracts.some(
      (item) =>
        !families.includes(item.family) ||
        !isHtxDerivativesFillContract(item.family, item.contract),
    )
  ) {
    throw new AccountObservationReadFailure("PERMISSION_DENIED");
  }
  const fillContracts = Object.freeze(
    rawFillContracts.map((item) =>
      Object.freeze({
        family: item.family,
        contract: item.contract,
      }),
    ),
  );
  const clock = Object.freeze({
    now: input.clock.now.bind(input.clock),
    sleep: input.clock.sleep.bind(input.clock),
  });
  const transports = new Set<HtxDerivativesAccountTransport>();
  let disposed = false;
  let reading = false;
  const dispose = () => {
    disposed = true;
    for (const transport of transports) transport.dispose();
  };
  return Object.freeze({
    async readDerivativesAccount(family: HtxDerivativesAccountFamily, signal: AbortSignal) {
      if (disposed || reading || signal.aborted || !families.includes(family)) {
        throw new AccountObservationReadFailure("PERMISSION_DENIED");
      }
      reading = true;
      let transport: HtxDerivativesAccountTransport | undefined;
      try {
        const accessKey = credential.apiKey;
        const secret = credential.apiSecret;
        if (
          !sameObservationBinding(credential.binding, binding) ||
          fingerprint(accessKey, secret) !== openedKeyFingerprint
        ) {
          throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
        }
        // A failed family must not poison another family's independent read.
        // All transports remain owned until their cancellation has settled.
        transport = createHtxDerivativesAccountTransport({
          binding: {
            organizationId: binding.organizationId,
            credentialId: binding.credentialId,
            credentialRevision: binding.credentialRevision,
          },
          accessKey,
          secret,
          host: "api.hbdm.com",
          clock,
          fetchImpl,
          timeoutMs,
          maxResponseBytes,
          async verifyReadAdmission(request, admissionSignal) {
            if (
              disposed ||
              request.family !== family ||
              !families.includes(request.family) ||
              request.binding.organizationId !== binding.organizationId ||
              request.binding.credentialId !== binding.credentialId ||
              request.binding.credentialRevision !== binding.credentialRevision ||
              !sameObservationBinding(credential.binding, binding) ||
              fingerprint(credential.apiKey, credential.apiSecret) !== openedKeyFingerprint
            )
              return false;
            const granted = await verifyReadOnlyAdmission(
              binding,
              request.accessKeySha256,
              admissionSignal,
            );
            return (
              granted === true &&
              !disposed &&
              !admissionSignal.aborted &&
              sameObservationBinding(credential.binding, binding) &&
              fingerprint(credential.apiKey, credential.apiSecret) === openedKeyFingerprint
            );
          },
        });
        transports.add(transport);
        const snapshot = parseHtxDerivativesAccountSnapshot(
          family,
          await transport.readAccount(family, signal),
        );
        if (disposed || signal.aborted) throw new AccountObservationReadFailure("READ_FAILED");
        const positionStartedAtMs = clock.now();
        if (!Number.isSafeInteger(positionStartedAtMs) || positionStartedAtMs < 0) {
          throw new AccountObservationReadFailure("INVALID_RESPONSE");
        }
        let positions: Readonly<{
          status: "COMPLETE" | "PARTIAL" | "ERROR";
          values: readonly HtxDerivativesPositionRow[] | null;
          readStartedAtMs: number;
          readCompletedAtMs: number;
          responseGeneratedAtMs: number | null;
          error: ObservationReadError | null;
        }>;
        try {
          const positionSnapshot = parseHtxDerivativesPositionsSnapshot(
            family,
            await transport.readPositions(family, signal),
          );
          const positionCompletedAtMs = clock.now();
          if (
            disposed ||
            signal.aborted ||
            !Number.isSafeInteger(positionCompletedAtMs) ||
            positionCompletedAtMs < positionStartedAtMs ||
            (positionSnapshot.responseGeneratedAtMs !== null &&
              positionSnapshot.responseGeneratedAtMs > positionCompletedAtMs)
          ) {
            throw new AccountObservationReadFailure("READ_FAILED");
          }
          const partial = positionSnapshot.positions.some(
            (position) =>
              position.volume === null ||
              position.available === null ||
              position.frozen === null ||
              position.costOpen === null ||
              position.costHold === null ||
              position.unrealizedPnl === null ||
              position.positionMargin === null ||
              position.leverage === null,
          );
          positions = Object.freeze({
            status: partial ? "PARTIAL" : "COMPLETE",
            values: positionSnapshot.positions,
            readStartedAtMs: positionStartedAtMs,
            readCompletedAtMs: positionCompletedAtMs,
            responseGeneratedAtMs: positionSnapshot.responseGeneratedAtMs,
            error: null,
          });
        } catch (error) {
          const positionCompletedAtMs = clock.now();
          const code: ObservationReadError =
            error instanceof AccountObservationReadFailure &&
            [
              "TIMEOUT",
              "RATE_LIMITED",
              "PERMISSION_DENIED",
              "READ_FAILED",
              "INVALID_RESPONSE",
              "IDENTITY_MISMATCH",
            ].includes(error.code)
              ? (error.code as ObservationReadError)
              : error instanceof Error && error.message === "HTX_DERIVATIVES_INVALID_RESPONSE"
                ? "INVALID_RESPONSE"
                : "READ_FAILED";
          // Admission or identity refusal invalidates the family result; a venue,
          // timeout, or parser failure may leave the already-read account visible.
          if (
            disposed ||
            signal.aborted ||
            code === "PERMISSION_DENIED" ||
            code === "IDENTITY_MISMATCH"
          )
            throw error;
          positions = Object.freeze({
            status: "ERROR",
            values: null,
            readStartedAtMs: positionStartedAtMs,
            readCompletedAtMs:
              Number.isSafeInteger(positionCompletedAtMs) &&
              positionCompletedAtMs >= positionStartedAtMs
                ? positionCompletedAtMs
                : positionStartedAtMs,
            responseGeneratedAtMs: null,
            error: code,
          });
        }
        const contracts = fillContracts
          .filter((item) => item.family === family)
          .map((item) => item.contract);
        const fillStartedAtMs = clock.now();
        if (!Number.isSafeInteger(fillStartedAtMs) || fillStartedAtMs < 0) {
          throw new AccountObservationReadFailure("INVALID_RESPONSE");
        }
        let executions: Readonly<{
          status: "NOT_CONFIGURED" | "COMPLETE" | "PARTIAL" | "ERROR";
          coverage: "CONFIGURED_CONTRACTS" | "NOT_CONFIGURED";
          values: readonly HtxDerivativesFillRow[] | null;
          contracts: readonly string[];
          readStartedAtMs: number;
          readCompletedAtMs: number;
          responseGeneratedAtMs: number | null;
          windowStartMs: number | null;
          windowEndMs: number | null;
          error: ObservationReadError | null;
        }>;
        if (!contracts.length) {
          executions = Object.freeze({
            status: "NOT_CONFIGURED",
            coverage: "NOT_CONFIGURED",
            values: null,
            contracts: Object.freeze([]),
            readStartedAtMs: fillStartedAtMs,
            readCompletedAtMs: fillStartedAtMs,
            responseGeneratedAtMs: null,
            windowStartMs: null,
            windowEndMs: null,
            error: null,
          });
        } else {
          const windowEndMs = fillStartedAtMs;
          const windowStartMs = windowEndMs - HTX_DERIVATIVES_FILL_LOOKBACK_MS;
          try {
            if (!Number.isSafeInteger(windowStartMs) || windowStartMs < 0) {
              throw new AccountObservationReadFailure("INVALID_RESPONSE");
            }
            const kept: HtxDerivativesFillRow[] = [];
            const seen = new Map<string, string>();
            let partial = false;
            let responseGeneratedAtMs: number | null = null;
            let missingTimestamp = false;
            const notNewer = (next: string, previous: string) =>
              previous !== "" && BigInt(next) <= BigInt(previous);
            for (const contract of contracts) {
              if (partial) break;
              let fromId: string | undefined;
              let previousFrom = "";
              let finished = false;
              for (let page = 0; page < HTX_DERIVATIVES_FILL_MAX_PAGES; page += 1) {
                const parsed = parseHtxDerivativesFillsPage(
                  family,
                  contract,
                  await transport.readFills(
                    family,
                    contract,
                    windowStartMs,
                    windowEndMs,
                    fromId,
                    signal,
                  ),
                );
                if (parsed.responseGeneratedAtMs === null) missingTimestamp = true;
                else if (!missingTimestamp) {
                  responseGeneratedAtMs =
                    responseGeneratedAtMs === null
                      ? parsed.responseGeneratedAtMs
                      : Math.max(responseGeneratedAtMs, parsed.responseGeneratedAtMs);
                }
                if (parsed.fills.length === 0) {
                  finished = true;
                  break;
                }
                if (kept.length + parsed.fills.length > HTX_DERIVATIVES_FILL_MAX_ROWS) {
                  partial = true;
                  break;
                }
                for (const row of parsed.fills) {
                  if (
                    row.executedAtMs !== null &&
                    (row.executedAtMs < windowStartMs || row.executedAtMs > windowEndMs)
                  ) {
                    throw new AccountObservationReadFailure("INVALID_RESPONSE");
                  }
                  const canonical = JSON.stringify(row);
                  const previous = seen.get(row.id);
                  if (previous === undefined) {
                    seen.set(row.id, canonical);
                    kept.push(row);
                  } else if (previous !== canonical)
                    throw new AccountObservationReadFailure("INVALID_RESPONSE");
                }
                if (!parsed.nextFromId || notNewer(parsed.nextFromId, previousFrom)) {
                  partial = true;
                  break;
                }
                previousFrom = parsed.nextFromId;
                fromId = parsed.nextFromId;
                if (page === HTX_DERIVATIVES_FILL_MAX_PAGES - 1) partial = true;
              }
              if (!finished) partial = true;
            }
            if (missingTimestamp) responseGeneratedAtMs = null;
            const fillCompletedAtMs = clock.now();
            if (
              disposed ||
              signal.aborted ||
              !Number.isSafeInteger(fillCompletedAtMs) ||
              fillCompletedAtMs < fillStartedAtMs ||
              (responseGeneratedAtMs !== null && responseGeneratedAtMs > fillCompletedAtMs)
            ) {
              throw new AccountObservationReadFailure("READ_FAILED");
            }
            const incompleteRow = kept.some(
              (row) =>
                row.volume === null ||
                row.price === null ||
                row.fee === null ||
                row.feeAsset === null ||
                row.executedAtMs === null,
            );
            executions = Object.freeze({
              status: partial || incompleteRow ? "PARTIAL" : "COMPLETE",
              coverage: "CONFIGURED_CONTRACTS",
              values: Object.freeze(kept),
              contracts: Object.freeze([...contracts]),
              readStartedAtMs: fillStartedAtMs,
              readCompletedAtMs: fillCompletedAtMs,
              responseGeneratedAtMs,
              windowStartMs,
              windowEndMs,
              error: null,
            });
          } catch (error) {
            const fillCompletedAtMs = clock.now();
            const code: ObservationReadError =
              error instanceof AccountObservationReadFailure &&
              [
                "TIMEOUT",
                "RATE_LIMITED",
                "PERMISSION_DENIED",
                "READ_FAILED",
                "INVALID_RESPONSE",
                "IDENTITY_MISMATCH",
              ].includes(error.code)
                ? (error.code as ObservationReadError)
                : error instanceof Error && error.message === "HTX_DERIVATIVES_INVALID_RESPONSE"
                  ? "INVALID_RESPONSE"
                  : "READ_FAILED";
            if (
              disposed ||
              signal.aborted ||
              code === "PERMISSION_DENIED" ||
              code === "IDENTITY_MISMATCH"
            )
              throw error;
            executions = Object.freeze({
              status: "ERROR",
              coverage: "CONFIGURED_CONTRACTS",
              values: null,
              contracts: Object.freeze([...contracts]),
              readStartedAtMs: fillStartedAtMs,
              readCompletedAtMs:
                Number.isSafeInteger(fillCompletedAtMs) && fillCompletedAtMs >= fillStartedAtMs
                  ? fillCompletedAtMs
                  : fillStartedAtMs,
              responseGeneratedAtMs: null,
              windowStartMs,
              windowEndMs,
              error: code,
            });
          }
        }
        return Object.freeze({ binding, snapshot, positions, executions });
      } finally {
        reading = false;
        if (transport) {
          const owned = transport;
          owned.dispose();
          void owned.settled().then(
            () => transports.delete(owned),
            () => {
              /* Retain failed cancellation for shutdown. */
            },
          );
        }
      }
    },
    dispose,
    async settled() {
      dispose();
      await Promise.all([...transports].map((transport) => transport.settled()));
    },
  });
}
