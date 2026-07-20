export const D20_DRAWDOWN_POLICY_VERSION = "htr-wp16-d20-drawdown/v1";

export type DrawdownBreachState = "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";

export type DrawdownPolicyConfig = {
  accountBps: number;
  monthlyBps: number;
  strategyBps: number;
  calendarMonthTimezone: "UTC";
};

export const DEFAULT_D20_DRAWDOWN_POLICY: DrawdownPolicyConfig = {
  accountBps: 2500,
  monthlyBps: 1500,
  strategyBps: 2000,
  calendarMonthTimezone: "UTC",
};

export type AccountDrawdownState = {
  organizationId: string;
  accountKey: string;
  portfolioId: string;
  runId: string;
  seq: number;
  asOf: string;
  monthKey: string;
  equityUsdt: string;
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  breachState: DrawdownBreachState;
};

export type StrategyDrawdownState = {
  organizationId: string;
  accountKey: string;
  portfolioId: string;
  runId: string;
  strategyId: string;
  strategyVersion: string;
  seq: number;
  asOf: string;
  monthKey: string;
  strategyEquityUsdt: string;
  strategyPeakHwm: string;
  strategyDrawdownBps: number;
  breachState: DrawdownBreachState;
};

export type MonthlyDrawdownState = {
  monthKey: string;
  monthlyPeakHwm: string;
  monthlyDrawdownBps: number;
};

export type DrawdownPolicyEvaluationInput = {
  equityUsdt: string;
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  strategyEquityUsdt?: string;
  strategyPeakHwm?: string;
  config?: DrawdownPolicyConfig;
};

export type DrawdownPolicyEvaluationResult = {
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  strategyDrawdownBps: number | null;
  accountBreached: boolean;
  monthlyBreached: boolean;
  strategyBreached: boolean;
  breachState: DrawdownBreachState;
};
