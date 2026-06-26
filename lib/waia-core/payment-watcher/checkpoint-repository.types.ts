export type WatcherCheckpointView = {
  network: string;
  lastScannedBlock: string;
  lastScannedAt: Date;
  leaseUntil: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  cycleCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WatcherCheckpointRepository = {
  load(network: string): Promise<WatcherCheckpointView | null>;
  bootstrap(network: string, startBlock: string): Promise<WatcherCheckpointView>;
  /** Atomic compare-and-set lease; returns false when another instance holds the lease. */
  tryAcquireLease(network: string, leaseTtlSeconds: number): Promise<boolean>;
  releaseLease(network: string): Promise<void>;
  saveProgress(
    network: string,
    lastScannedBlock: string,
    incrementCycle?: boolean,
  ): Promise<WatcherCheckpointView>;
  recordError(network: string, message: string): Promise<void>;
};
