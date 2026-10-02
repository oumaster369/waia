/**
 * Node-only Vitest module-resolution stub for the Worker built-in.
 * This never models or proves Worker socket behavior; accidental Worker runtime
 * selection in a Node test must fail closed instead of attempting a network call.
 */
export function connect(): never {
  throw new Error("WORKER_SOCKETS_UNAVAILABLE_IN_NODE_TESTS");
}
