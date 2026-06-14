export class KillSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KillSwitchError";
  }
}

export class KillSwitchAuthorizationError extends KillSwitchError {
  constructor(message = "KILL_SWITCH_AUTHORIZATION_DENIED") {
    super(message);
    this.name = "KillSwitchAuthorizationError";
  }
}

export class UnsupportedKillSwitchScopeError extends KillSwitchError {
  constructor(scopeType: string) {
    super(`KILL_SWITCH_SCOPE_UNSUPPORTED:${scopeType}`);
    this.name = "UnsupportedKillSwitchScopeError";
  }
}

export class IllegalKillSwitchTransitionError extends KillSwitchError {
  constructor(from: string, to: string) {
    super(`KILL_SWITCH_ILLEGAL_TRANSITION:${from}->${to}`);
    this.name = "IllegalKillSwitchTransitionError";
  }
}

export const KILL_SWITCH_ALREADY_ACTIVE = "KILL_SWITCH_ALREADY_ACTIVE";

export class KillSwitchConcurrencyError extends KillSwitchError {
  constructor(message = "KILL_SWITCH_CONCURRENCY_CONFLICT") {
    super(message);
    this.name = "KillSwitchConcurrencyError";
  }
}

export function isAlreadyActiveError(error: unknown): error is KillSwitchConcurrencyError {
  return (
    error instanceof KillSwitchConcurrencyError && error.message === KILL_SWITCH_ALREADY_ACTIVE
  );
}

export class KillSwitchNotFoundError extends KillSwitchError {
  constructor(message = "KILL_SWITCH_NOT_FOUND") {
    super(message);
    this.name = "KillSwitchNotFoundError";
  }
}
