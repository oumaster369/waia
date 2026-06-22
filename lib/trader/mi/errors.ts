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
