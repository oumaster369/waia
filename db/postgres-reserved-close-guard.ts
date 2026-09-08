import type postgres from "postgres";

type Lease = { closed: boolean; released: boolean };

function unavailable(lease: Lease): Error & { code: string } {
  return Object.assign(new Error(lease.closed
    ? "POSTGRES_RESERVED_SESSION_CONNECTION_CLOSED"
    : "POSTGRES_RESERVED_SESSION_RELEASED"), {
    code: lease.closed ? "CONNECTION_CLOSED" : "RESERVED_SESSION_RELEASED",
  });
}

/**
 * Opt-in for single-connection CLI campaigns only. A closed backend invalidates
 * its reservation permanently; this adapter never reconnects or retries work.
 * postgres.js reserved handles otherwise dispatch directly to a dead connection.
 */
export function guardSingleConnectionPostgresPool(pool: postgres.Sql): postgres.Sql {
  if (pool.options?.max !== 1) {
    throw new Error("POSTGRES_RESERVED_CLOSE_GUARD_REQUIRES_SINGLE_CONNECTION");
  }
  let active: Lease | undefined;
  const previousOnClose = pool.options.onclose;
  pool.options.onclose = (id: number) => {
    if (active) active.closed = true;
    previousOnClose?.(id);
  };

  function wrapReserved(reserved: postgres.ReservedSql, lease: Lease) {
    const assertUsable = () => {
      if (lease.closed || lease.released) throw unavailable(lease);
    };
    const queries = new WeakMap<object, object>();
    function wrapQuery(value: unknown): unknown {
      if (!value || typeof value !== "object" ||
          typeof (value as { then?: unknown }).then !== "function") return value;
      const existing = queries.get(value);
      if (existing) return existing;
      const proxy = new Proxy(value, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (typeof member !== "function") return member;
          return (...args: unknown[]) => {
            // Awaiting a query created BEFORE closure must reject too. Preserve
            // Promise rejection semantics rather than throwing outside .catch().
            if ((lease.closed || lease.released) &&
                (property === "then" || property === "catch" || property === "finally")) {
              const rejected = Promise.reject(unavailable(lease));
              return Reflect.apply(Reflect.get(rejected, property), rejected, args);
            }
            assertUsable();
            const result = Reflect.apply(member, target, args);
            if (result === target) return proxy;
            // Cursor consumption is deferred independently of the Query.then.
            const iterable = result as AsyncIterable<unknown> | undefined;
            if (property === "cursor" && typeof iterable?.[Symbol.asyncIterator] === "function") {
              return {
                [Symbol.asyncIterator]() {
                  const iterator = iterable[Symbol.asyncIterator]();
                  return {
                    next(...nextArgs: unknown[]) {
                      if (lease.closed || lease.released) return Promise.reject(unavailable(lease));
                      return Reflect.apply(iterator.next, iterator, nextArgs);
                    },
                    return(...returnArgs: unknown[]) {
                      assertUsable();
                      return iterator.return
                        ? Reflect.apply(iterator.return, iterator, returnArgs)
                        : { done: true };
                    },
                  };
                },
              };
            }
            return result;
          };
        },
      });
      queries.set(value, proxy);
      return proxy;
    }
    return new Proxy(reserved, {
      apply(target, _thisArg, args) {
        assertUsable();
        return wrapQuery(Reflect.apply(target, target, args));
      },
      get(target, property) {
        // file() asynchronously constructs/assimilates its Query inside the
        // driver, outside this lazy-query boundary. Historical CLIs do not use
        // it; refuse it rather than expose an unguarded delayed dispatch path.
        if (property === "file") return () => {
          throw new Error("POSTGRES_RESERVED_CLOSE_GUARD_FILE_QUERY_UNSUPPORTED");
        };
        if (property === "release") return () => {
          if (lease.released) return;
          lease.released = true;
          if (active === lease) active = undefined;
          // Driver.release() would put its already closed connection back in
          // the ready queue. Closure has already released server-side locks.
          if (!lease.closed) target.release();
        };
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          assertUsable();
          return wrapQuery(Reflect.apply(member, target, args));
        };
      },
    });
  }

  return new Proxy(pool, {
    get(target, property) {
      if (property === "reserve") return async () => {
        if (active) throw new Error("POSTGRES_RESERVED_CLOSE_GUARD_ALREADY_RESERVED");
        const lease: Lease = { closed: false, released: false };
        active = lease;
        try {
          const reserved = await target.reserve();
          if (lease.closed) throw unavailable(lease);
          return wrapReserved(reserved, lease);
        } catch (error) {
          if (active === lease) active = undefined;
          throw error;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
