import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresMock, createTransportMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("@/lib/trader/paper/scheduled-owned-postgres-transport-v1", () => ({
  createScheduledPostgresTransportV1: createTransportMock,
}));

import { withScheduledOwnedPostgresPoolV1 } from "@/lib/trader/paper/scheduled-owned-postgres-pool-v1";

const URL = "postgres://fixture@localhost/test?sslmode=disable";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("withScheduledOwnedPostgresPoolV1 lifetime", () => {
  let endMock: ReturnType<typeof vi.fn>;
  let sealMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    endMock = vi.fn().mockResolvedValue(undefined);
    sealMock = vi.fn();
    closeMock = vi.fn().mockResolvedValue(undefined);
    createTransportMock.mockResolvedValue({ socket: vi.fn(), seal: sealMock, close: closeMock });
    postgresMock.mockReturnValue({ end: endMock });
  });

  it("preserves a fulfilled work value when abort cleanup rejects pool.end", async () => {
    const controller = new AbortController();
    const endFailure = new Error("cleanup end failed");
    endMock.mockRejectedValue(endFailure);

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      controller.abort(new Error("deadline elapsed during cleanup"));
      return "committed-result";
    })).resolves.toBe("committed-result");
    expect(endMock).toHaveBeenCalledWith({ timeout: 0 });
    expect(sealMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the work rejection when pool.end also rejects", async () => {
    const controller = new AbortController();
    const workFailure = new Error("work failed");
    endMock.mockRejectedValue(new Error("cleanup end failed"));

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      controller.abort();
      throw workFailure;
    })).rejects.toBe(workFailure);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("does not return on abort until deferred work has actually settled", async () => {
    const controller = new AbortController();
    const work = deferred<string>();
    let entered = false;
    let returned = false;
    const operation = withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      entered = true;
      return work.promise;
    }).then((value) => { returned = true; return value; });

    await Promise.resolve();
    expect(entered).toBe(true);
    controller.abort();
    await Promise.resolve();
    expect(returned).toBe(false);
    work.resolve("settled-value");
    await expect(operation).resolves.toBe("settled-value");
    expect(returned).toBe(true);
  });

  it("awaits transport.close before returning the work result", async () => {
    const close = deferred<void>();
    closeMock.mockReturnValue(close.promise);
    let returned = false;
    const operation = withScheduledOwnedPostgresPoolV1(URL, new AbortController().signal,
      async () => "result").then((value) => { returned = true; return value; });

    await Promise.resolve();
    await Promise.resolve();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(returned).toBe(false);
    close.resolve();
    await expect(operation).resolves.toBe("result");
    expect(returned).toBe(true);
  });

  it("does not construct transport or postgres for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => "unused"))
      .rejects.toThrow();
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(postgresMock).not.toHaveBeenCalled();
  });
});
