import "server-only";
import { createHash } from "node:crypto";
import type { HtxObservationCredentialHandle } from "../htx-reader-opener";
import { AccountObservationReadFailure } from "../service";
import type { ObservationBinding, ObservationClock } from "../types";
import { observationBindingSchema, sameObservationBinding } from "../validation";
import { createHtxDerivativesAccountTransport, type HtxDerivativesAccountTransport } from "./htx-account-transport";
import { parseHtxDerivativesAccountSnapshot } from "./parser";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES, type HtxDerivativesAccountFamily } from "./types";

/** One exact opened key and explicit configuration-bound families. The composition
 * supplies concrete fresh read-only key admission; this reader cannot enroll a
 * family or confer trading authority. The containing spot reader owns the handle. */
export function createHtxDerivativesObservationReader(input: Readonly<{
  credential: HtxObservationCredentialHandle;
  families: readonly HtxDerivativesAccountFamily[];
  clock: ObservationClock;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  verifyReadOnlyAdmission(binding: ObservationBinding, keyDigest: string, signal: AbortSignal): Promise<boolean>;
}>) {
  const { credential, fetchImpl, timeoutMs, maxResponseBytes, verifyReadOnlyAdmission } = input;
  const binding = Object.freeze(observationBindingSchema.parse(credential.binding));
  const fingerprint = (key: string, secret: string) => createHash("sha256")
    .update(JSON.stringify([key, secret])).digest("hex");
  const openedKeyFingerprint = fingerprint(credential.apiKey, credential.apiSecret);
  if (!Array.isArray(input.families) || !input.families.length ||
    input.families.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length ||
    new Set(input.families).size !== input.families.length ||
    input.families.some(family => !HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)) ||
    typeof verifyReadOnlyAdmission !== "function") {
    throw new AccountObservationReadFailure("PERMISSION_DENIED");
  }
  const families = Object.freeze([...input.families]);
  const clock = Object.freeze({ now: input.clock.now.bind(input.clock), sleep: input.clock.sleep.bind(input.clock) });
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
        if (!sameObservationBinding(credential.binding, binding) ||
          fingerprint(accessKey, secret) !== openedKeyFingerprint) {
          throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
        }
        // A failed family must not poison another family's independent read.
        // All transports remain owned until their cancellation has settled.
        transport = createHtxDerivativesAccountTransport({
          binding: { organizationId: binding.organizationId, credentialId: binding.credentialId,
            credentialRevision: binding.credentialRevision },
          accessKey, secret,
          host: "api.hbdm.com", clock, fetchImpl, timeoutMs, maxResponseBytes,
          async verifyReadAdmission(request, admissionSignal) {
            if (disposed || request.family !== family || !families.includes(request.family) ||
              request.binding.organizationId !== binding.organizationId ||
              request.binding.credentialId !== binding.credentialId ||
              request.binding.credentialRevision !== binding.credentialRevision ||
              !sameObservationBinding(credential.binding, binding) ||
              fingerprint(credential.apiKey, credential.apiSecret) !== openedKeyFingerprint) return false;
            const granted = await verifyReadOnlyAdmission(binding, request.accessKeySha256, admissionSignal);
            return granted === true && !disposed && !admissionSignal.aborted &&
              sameObservationBinding(credential.binding, binding) &&
              fingerprint(credential.apiKey, credential.apiSecret) === openedKeyFingerprint;
          },
        });
        transports.add(transport);
        const snapshot = parseHtxDerivativesAccountSnapshot(family, await transport.readAccount(family, signal));
        if (disposed || signal.aborted) throw new AccountObservationReadFailure("READ_FAILED");
        return Object.freeze({ binding, snapshot });
      } finally {
        reading = false;
        if (transport) {
          const owned = transport;
          owned.dispose();
          void owned.settled().then(() => transports.delete(owned), () => { /* Retain failed cancellation for shutdown. */ });
        }
      }
    },
    dispose,
    async settled() {
      dispose();
      await Promise.all([...transports].map(transport => transport.settled()));
    },
  });
}
