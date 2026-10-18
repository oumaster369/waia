import "server-only";

const nativeGetReader = ReadableStream.prototype.getReader;
const nativeReaderClosed = Object.getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype, "closed",
)?.get;

export type ObservationResponseBodyOwner = Readonly<{
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  settled(): Promise<void>;
}>;

/** Acquire and retain the reader privately so terminal-state evidence always
 * belongs to this body. No caller can substitute or release the owned reader.
 * A native stream that errored before cancellation cannot deliver more bytes;
 * its redundant cancel() would only reject with the stored read error.
 */
export function createObservationResponseBodyOwner(
  body: ReadableStream<Uint8Array>,
): ObservationResponseBodyOwner {
  const native = body instanceof ReadableStream;
  // Bypass an overridden getReader: it could return another body's reader.
  // Structural/cross-realm bodies retain their ordinary cancel obligation.
  const reader = native ? nativeGetReader.call(body) as ReadableStreamDefaultReader<Uint8Array>
    : (body as ReadableStream<Uint8Array>).getReader();
  let alreadyErrored = false;
  if (native) {
    const closed = nativeReaderClosed?.call(reader) as Promise<void> | undefined;
    void closed?.then(() => {}, () => { alreadyErrored = true; });
  }
  let settlement: Promise<void> | undefined;
  const settle = async () => {
    // Observe only a terminal error preceding cancellation. Do not wait for a
    // pending closed promise or accept cancellation's own state change as proof.
    await Promise.resolve();
    if (alreadyErrored) return;
    await reader.cancel();
  };
  return Object.freeze({
    read: () => reader.read(),
    // Cache failure/pending cancellation too: closing the native stream does not
    // discharge an underlying cancel operation that rejects or remains pending.
    settled: () => settlement ??= settle(),
  });
}

/** Cleanup before consumption acquires ownership without reading any bytes. */
export async function settleObservationResponseBody(
  body: ReadableStream<Uint8Array> | null | undefined,
): Promise<void> {
  if (body) await createObservationResponseBodyOwner(body).settled();
}
