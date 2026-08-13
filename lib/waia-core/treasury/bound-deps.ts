import type { AuditLogInput } from "@/lib/waia-core/types";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";

export type TreasuryBoundDeps = {
  repository: TreasuryRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
};

export function createTreasuryBoundRunner(deps: {
  repository: TreasuryRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  runAtomic?: <T>(fn: (bound: TreasuryBoundDeps) => Promise<T>) => Promise<T>;
}): {
  getBound: () => TreasuryBoundDeps;
  runAtomic: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  let bound: TreasuryBoundDeps = { repository: deps.repository, writeAudit: deps.writeAudit };
  return {
    getBound: () => bound,
    runAtomic: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (!deps.runAtomic) return fn();
      return deps.runAtomic(async (next) => {
        const previous = bound;
        bound = next;
        try {
          return await fn();
        } finally {
          bound = previous;
        }
      });
    },
  };
}
