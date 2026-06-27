import type { miSourceStatusEnum } from "@/db/schema";

export type MiSourceStatus = (typeof miSourceStatusEnum)[number];

export type MiSourceIdentity = {
  id: string;
  organizationId: string;
  venue: string;
  feedKind: string;
  symbol: string | null;
  description: string | null;
  status: MiSourceStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateMiSourceInput = {
  venue: string;
  feedKind: string;
  symbol?: string | null;
  description?: string | null;
  status?: MiSourceStatus;
};
