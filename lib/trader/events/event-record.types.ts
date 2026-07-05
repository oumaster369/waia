export const EVENT_RECORD_ROW_SCHEMA_VERSION = "waia.trader.event-record-row.v1" as const;

export type EventRecordRow = {
  id: string;
  organizationId: string;
  eventKey: string;
  sourceRef: string;
  symbolScope: string;
  payloadJson: string;
  eventTime: Date;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEventRecordRow = {
  id: string;
  eventKey: string;
  sourceRef: string;
  symbolScope: string;
  payloadJson: string;
  eventTime: Date;
  contentDigest: string;
  createdAt: Date;
};

export type EventClassificationRow = {
  id: string;
  organizationId: string;
  eventRecordId: string;
  classificationKind: string;
  ruleId: string;
  confidence: string;
  rationaleJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEventClassificationRow = {
  id: string;
  eventRecordId: string;
  classificationKind: string;
  ruleId: string;
  confidence: string;
  rationaleJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type EventAttributionRow = {
  id: string;
  organizationId: string;
  eventRecordId: string;
  subjectRef: string;
  subjectKind: string;
  windowStart: Date;
  windowEnd: Date;
  attributionStrength: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEventAttributionRow = {
  id: string;
  eventRecordId: string;
  subjectRef: string;
  subjectKind: string;
  windowStart: Date;
  windowEnd: Date;
  attributionStrength: string;
  contentDigest: string;
  createdAt: Date;
};

export type EventAttributionConfidenceRow = {
  id: string;
  organizationId: string;
  eventRecordId: string;
  subjectRef: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorSupporting: number;
  priorContradicting: number;
  rationaleJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEventAttributionConfidenceRow = {
  id: string;
  eventRecordId: string;
  subjectRef: string;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  priorSupporting: number;
  priorContradicting: number;
  rationaleJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type EventExplanationRow = {
  id: string;
  organizationId: string;
  subjectRef: string;
  priceMoveJson: string;
  eventRefsJson: string;
  patternRefsJson: string;
  scoreBreakdownJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEventExplanationRow = {
  id: string;
  subjectRef: string;
  priceMoveJson: string;
  eventRefsJson: string;
  patternRefsJson: string;
  scoreBreakdownJson: string;
  contentDigest: string;
  createdAt: Date;
};
