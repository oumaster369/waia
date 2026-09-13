/** Application bounds, shared by the stored-projection stream and its browser reader. */
export const OBSERVATION_STREAM_MAX_MS = 25_000;
export const OBSERVATION_STREAM_INTERVAL_MS = 5_000;
// Includes the authorization preflight; at most three projection frames follow.
export const OBSERVATION_STREAM_MAX_CYCLES = 4;
export const OBSERVATION_STREAM_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const OBSERVATION_STREAM_MAX_BYTES =
  OBSERVATION_STREAM_MAX_FRAME_BYTES * OBSERVATION_STREAM_MAX_CYCLES;
export type ObservationStreamEvent = "observation" | "missing" | "revoked" | "error";
