export type AuditFilterRow = {
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
};

export type AuditPageFilter = {
  actor?: string | null;
  action?: string | null;
  entity?: string | null;
};

function needle(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/** Filters one already-fetched audit page. It does not query the database. */
export function filterAuditRows<T extends AuditFilterRow>(
  rows: readonly T[],
  filter: AuditPageFilter,
): T[] {
  const actor = needle(filter.actor);
  const action = needle(filter.action);
  const entity = needle(filter.entity);
  return rows.filter((row) => {
    if (actor) {
      const haystack = `${row.actorType} ${row.actorId ?? ""}`.toLowerCase();
      if (!haystack.includes(actor)) return false;
    }
    if (action && !row.action.toLowerCase().includes(action)) return false;
    if (entity) {
      const haystack = `${row.entityType} ${row.entityId ?? ""}`.toLowerCase();
      if (!haystack.includes(entity)) return false;
    }
    return true;
  });
}
