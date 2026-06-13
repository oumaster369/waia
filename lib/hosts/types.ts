/** Chartered module hosts only — extend when a new module subdomain is approved. */
export type ModuleKey = "primary" | "trader";

export interface ModuleHost {
  module: ModuleKey;
  /** Normalized hostname without port. */
  host: string;
  /** Canonical origin (scheme + host, port in dev when present). */
  origin: string;
}
