/** Shared API error envelopes (readiness route + auth). */
export type ApiErrorEnvelope = {
  error: {
    code: string;
    message?: string;
  };
};
