export const STRATEGY_TRIAL_SCHEMA_VERSION = "htr-wp16-strategy-trial/v1";

export type StrategyTrialEvent = {
  id: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  runId: string;
  cycleId: string;
  symbol: string;
  accountKey: string;
  portfolioId: string;
  seq: number;
  eventTime: string;
  ingestTime: string;
  registeredBy: string;
  contentDigest: string;
  createdAt: string;
};

export type StrategyTrialRegistrationInput = {
  strategyId: string;
  strategyVersion: string;
  runId: string;
  cycleId: string;
  symbol: string;
  accountKey: string;
  portfolioId: string;
  eventTime: string;
  ingestTime: string;
  registeredBy: string;
  deterministicId: string;
};

export type StrategyTrialCounts = {
  strategyId: string;
  strategyVersion: string;
  runId: string;
  total: number;
};
