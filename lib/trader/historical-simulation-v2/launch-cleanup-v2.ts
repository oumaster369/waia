/** Run every cleanup step without replacing the operation's original failure. */
export async function withHistoricalLaunchCleanupV2<T>(
  operation: () => Promise<T>,
  cleanup: readonly (() => void | Promise<void>)[],
): Promise<T> {
  let failed = false;
  let primaryError: unknown;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const step of cleanup) {
      try { await step(); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length > 0) {
      // Messages are fixed codes: never interpolate SQL, connection strings or secrets.
      // Keep the original errors/cause for the private diagnostic error chain.
      throw new AggregateError(
        failed ? [primaryError, ...cleanupErrors] : cleanupErrors,
        failed ? "HISTORICAL_LAUNCH_PRIMARY_AND_CLEANUP_FAILED"
          : "HISTORICAL_LAUNCH_CLEANUP_FAILED",
        { cause: failed ? primaryError : cleanupErrors[0] },
      );
    }
  }
}
