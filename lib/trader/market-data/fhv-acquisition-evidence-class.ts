/**
 * Acquisition evidence class — REAL provider data vs deterministic scale fixture.
 * Legacy v1 receipts without this field are unclassified and cannot qualify as real.
 */

export const FHV_ACQUISITION_RECEIPT_SCHEMA_V1 = "fhv-acquisition-receipt/v1" as const;
export const FHV_ACQUISITION_RECEIPT_SCHEMA_V2 = "fhv-acquisition-receipt/v2" as const;

export const FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA = "REAL_PROVIDER_DATA" as const;
export const FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE = "TEST_SCALE_FIXTURE" as const;

export type FhvAcquisitionEvidenceClass =
  | typeof FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA
  | typeof FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE;

export class FhvAcquisitionEvidenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvAcquisitionEvidenceError";
  }
}

export function assertRealProviderAcquisitionEvidenceClass(
  evidenceClass: unknown,
): asserts evidenceClass is typeof FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA {
  if (evidenceClass !== FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA) {
    throw new FhvAcquisitionEvidenceError(
      "ACQUISITION_EVIDENCE_NOT_REAL_PROVIDER_DATA",
      `evidenceClass ${String(evidenceClass)} is not ${FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA}`,
    );
  }
}

export function assertNotRelabelledAcquisitionEvidence(input: {
  from: FhvAcquisitionEvidenceClass;
  to: FhvAcquisitionEvidenceClass;
}): void {
  if (input.from !== input.to) {
    throw new FhvAcquisitionEvidenceError(
      "ACQUISITION_EVIDENCE_RELABEL_FORBIDDEN",
      `cannot relabel ${input.from} as ${input.to}`,
    );
  }
}
