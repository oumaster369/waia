export class PitViolationError extends Error {
  constructor(message = "INGEST_BEFORE_EVENT") {
    super(message);
    this.name = "PitViolationError";
  }
}

export class MiSourceDuplicateError extends Error {
  constructor(message = "MI_SOURCE_DUPLICATE") {
    super(message);
    this.name = "MiSourceDuplicateError";
  }
}

export class MiSourceNotFoundError extends Error {
  constructor(message = "MI_SOURCE_NOT_FOUND") {
    super(message);
    this.name = "MiSourceNotFoundError";
  }
}

export class EventTimeNotKnowableError extends Error {
  constructor(message = "EVENT_TIME_NOT_KNOWABLE") {
    super(message);
    this.name = "EventTimeNotKnowableError";
  }
}

export class MiObservationDuplicateError extends Error {
  constructor(message = "MI_OBSERVATION_DUPLICATE") {
    super(message);
    this.name = "MiObservationDuplicateError";
  }
}

export class MiObservationNotFoundError extends Error {
  constructor(message = "MI_OBSERVATION_NOT_FOUND") {
    super(message);
    this.name = "MiObservationNotFoundError";
  }
}

export class MiMeasurementDuplicateError extends Error {
  constructor(message = "MI_MEASUREMENT_DUPLICATE") {
    super(message);
    this.name = "MiMeasurementDuplicateError";
  }
}

export class MiMeasurementNotFoundError extends Error {
  constructor(message = "MI_MEASUREMENT_NOT_FOUND") {
    super(message);
    this.name = "MiMeasurementNotFoundError";
  }
}

export class MiMeasurementInputValidationError extends Error {
  constructor(message = "MI_MEASUREMENT_INPUT_INVALID") {
    super(message);
    this.name = "MiMeasurementInputValidationError";
  }
}

export class MiPatternDuplicateError extends Error {
  constructor(message = "MI_PATTERN_DUPLICATE") {
    super(message);
    this.name = "MiPatternDuplicateError";
  }
}

export class MiPatternNotFoundError extends Error {
  constructor(message = "MI_PATTERN_NOT_FOUND") {
    super(message);
    this.name = "MiPatternNotFoundError";
  }
}

export class MiPatternStructuralDuplicateError extends Error {
  constructor(message = "MI_PATTERN_STRUCTURAL_DUPLICATE") {
    super(message);
    this.name = "MiPatternStructuralDuplicateError";
  }
}

export class MiPatternFirewallError extends Error {
  constructor(message = "MI_PATTERN_FIREWALL_VIOLATION") {
    super(message);
    this.name = "MiPatternFirewallError";
  }
}

export class MiPatternMeasurementRefError extends Error {
  constructor(message = "MI_PATTERN_MEASUREMENT_REF_INVALID") {
    super(message);
    this.name = "MiPatternMeasurementRefError";
  }
}

export class MiPatternLifecycleError extends Error {
  constructor(message = "MI_PATTERN_LIFECYCLE_INVALID") {
    super(message);
    this.name = "MiPatternLifecycleError";
  }
}
