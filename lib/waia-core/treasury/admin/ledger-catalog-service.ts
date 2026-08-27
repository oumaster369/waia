import { treasuryAccountKindEnum } from "@/db/core-enums";
import type { AuditLogInput } from "@/lib/waia-core/types";
import {
  budgetMonthStart,
  currentBudgetMonth,
  deriveCategoryBudgetAnnual,
  deriveCategoryBudgetMonth,
  normalizeBudgetMonth,
  normalizeCategoryCodeBase,
} from "@/lib/waia-core/treasury/admin/category-budget-truth";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type { TreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/ledger-catalog-repository.types";
import type {
  TreasuryAccountInput,
  TreasuryCategoryBudgetHistoryRecord,
  TreasuryAccountRecord,
  TreasuryCategoryInput,
  TreasuryCategoryRecord,
  TreasuryCounterpartyInput,
  TreasuryCounterpartyRecord,
  TreasuryLedgerCatalogPage,
  TreasuryLedgerCatalogQuery,
  TreasuryProjectInput,
  TreasuryProjectRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryActorContext } from "@/lib/waia-core/treasury/types";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";

const MAX_TEXT = 500;
const MAX_PAYMENT_TEXT = 2_000;

function requiredText(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TreasuryValidationError("INVALID_BODY", `${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new TreasuryValidationError("INVALID_BODY", `${label} is too long`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, max = MAX_TEXT): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label, max);
}

function optionalUrl(value: unknown): string | null {
  const normalized = optionalText(value, "websiteUrl");
  if (!normalized) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TreasuryValidationError("INVALID_BODY", "websiteUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TreasuryValidationError("INVALID_BODY", "websiteUrl must use http or https");
  }
  return parsed.toString();
}

function optionalEmail(value: unknown): string | null {
  const normalized = optionalText(value, "email");
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new TreasuryValidationError("INVALID_BODY", "email is invalid");
  }
  return normalized.toLocaleLowerCase();
}

function luhn(value: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function assertNoCustodyOrCardSecret(value: string | null, label: string): void {
  if (!value) return;
  if (/\b(private[ _-]?key|seed phrase|mnemonic|password|passphrase|cvv|cvc|pin)\b/i.test(value)) {
    throw new TreasuryValidationError(
      "CUSTODY_MATERIAL_FORBIDDEN",
      `${label} must not contain custody or authentication secrets`,
    );
  }
  const possiblePans = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  if (
    possiblePans.some((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    })
  ) {
    throw new TreasuryValidationError(
      "FULL_CARD_PAN_FORBIDDEN",
      `${label} must contain only masked card details`,
    );
  }
}

function optionalDate(value: unknown, label: string): string | null {
  const normalized = optionalText(value, label, 10);
  if (!normalized) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const parsed = match ? new Date(`${normalized}T00:00:00.000Z`) : null;
  if (
    !match ||
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be YYYY-MM-DD`);
  }
  return normalized;
}

function normalizeQuery(query: TreasuryLedgerCatalogQuery): TreasuryLedgerCatalogQuery {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  if ((query.afterName && !query.afterId) || (!query.afterName && query.afterId)) {
    throw new TreasuryValidationError(
      "INVALID_BODY",
      "afterName and afterId must be provided together",
    );
  }
  return {
    q: query.q?.trim() || undefined,
    active: query.active,
    limit,
    afterName: query.afterName,
    afterId: query.afterId,
  };
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  name: (row: T) => string,
): TreasuryLedgerCatalogPage<T> {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = hasMore ? items.at(-1) : undefined;
  return {
    items,
    next: last ? { afterName: name(last), afterId: last.id } : null,
  };
}

export function computeAnnualCategoryBudgetMicros(
  categories: readonly TreasuryCategoryRecord[],
  currency: string,
): bigint {
  const normalizedCurrency = requiredText(currency, "currency", 20).toLocaleUpperCase();
  let monthly = 0n;
  for (const category of categories) {
    if (!category.isActive) continue;
    if (category.currency.toLocaleUpperCase() !== normalizedCurrency) {
      throw new TreasuryValidationError(
        "BUDGET_CURRENCY_MISMATCH",
        "all active categories must use the annual budget currency",
      );
    }
    if (category.monthlyBudgetMicros < 0n) {
      throw new TreasuryValidationError("INVALID_MONEY", "monthly budget cannot be negative");
    }
    monthly += category.monthlyBudgetMicros;
  }
  return monthly * 12n;
}

export function createTreasuryLedgerCatalogService(deps: {
  repository: TreasuryLedgerCatalogRepository;
  listTransactions: (context: OrgContext) => Promise<TreasuryTransactionRecord[]>;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  watchedAddressExists?: (context: OrgContext, id: string) => Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
}) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function allCategories(context: OrgContext): Promise<TreasuryCategoryRecord[]> {
    const rows: TreasuryCategoryRecord[] = [];
    let afterName: string | undefined;
    let afterId: string | undefined;
    do {
      const pageRows = await deps.repository.categories.list(context, {
        limit: 100,
        afterName,
        afterId,
      });
      const current = pageRows.slice(0, 100);
      rows.push(...current);
      const last = pageRows.length > 100 ? current.at(-1) : undefined;
      afterName = last?.name;
      afterId = last?.id;
    } while (afterName && afterId);
    return rows;
  }

  function normalizedGroupName(value: unknown): string {
    return requiredText(value ?? "Other", "groupName", 100).replace(/\s+/g, " ");
  }

  function effectiveMonth(value: string | undefined, timestamp: Date): string {
    const month = value ? normalizeBudgetMonth(value) : currentBudgetMonth(timestamp);
    if (month < currentBudgetMonth(timestamp)) {
      throw new TreasuryValidationError(
        "PAST_BUDGET_MONTH_IMMUTABLE",
        "past category budget months require a dedicated audited correction contract",
      );
    }
    return month;
  }

  async function uniqueCategoryCode(context: OrgContext, name: string): Promise<string> {
    const base = normalizeCategoryCodeBase(name);
    for (let suffix = 1; suffix <= 9_999; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      if (!(await deps.repository.categories.findByCode(context, candidate))) return candidate;
    }
    throw new TreasuryValidationError("CATEGORY_CODE_EXHAUSTED", "category code space exhausted");
  }

  function budgetHistoryRecord(input: {
    organizationId: string;
    categoryId: string;
    month: string;
    groupName: string;
    amount: bigint;
    currency: string;
    timestamp: Date;
  }): TreasuryCategoryBudgetHistoryRecord {
    return {
      id: newId(),
      organizationId: input.organizationId,
      categoryId: input.categoryId,
      effectiveMonth: budgetMonthStart(input.month),
      groupName: input.groupName,
      monthlyBudgetMicros: input.amount,
      currency: input.currency,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    };
  }

  async function audit(
    actor: TreasuryActorContext,
    action: string,
    entityType: string,
    entityId: string,
    organizationId: string,
    reason: string,
  ) {
    await deps.writeAudit({
      actorType: actor.actorType,
      actorId: actor.actorUserId,
      action,
      entityType,
      entityId,
      organizationId,
      metadata: { reason },
    });
  }

  async function requireWatchedAddress(context: OrgContext, id: string | null): Promise<void> {
    if (!id) return;
    if (!deps.watchedAddressExists || !(await deps.watchedAddressExists(context, id))) {
      throw new TreasuryValidationError(
        "CROSS_ORG_REFERENCE",
        "watchedAddressId must reference an address in the same organization",
      );
    }
  }

  return {
    async deriveAnnualBudgetMicros(context: OrgContext, currency: string, year?: number) {
      const org = requireOrgContext(context.organizationId);
      const normalizedCurrency = requiredText(currency, "currency", 20).toLocaleUpperCase();
      const categories = await allCategories(org);
      const history = await deps.repository.categoryBudgetHistory.list(org);
      const transactions = await deps.listTransactions(org);
      const targetYear = year ?? now().getUTCFullYear();
      const currentMonth = deriveCategoryBudgetMonth({
        month: `${targetYear}-${String(now().getUTCMonth() + 1).padStart(2, "0")}`,
        categories,
        history,
        transactions,
      });
      const total = currentMonth.totals.find((row) => row.currency === normalizedCurrency);
      const activeCategoryCount = categories.filter((row) => row.isActive).length;
      if (
        currentMonth.totals.some(
          (row) => row.currency !== normalizedCurrency && row.budgetMicros > 0n,
        )
      ) {
        throw new TreasuryValidationError(
          "BUDGET_CURRENCY_MISMATCH",
          "all active category budgets must use the annual budget currency",
        );
      }
      return {
        amountMicros: (total?.budgetMicros ?? 0n) * 12n,
        activeCategoryCount,
      };
    },
    async getBudgetMonthSummary(context: OrgContext, month: string) {
      const org = requireOrgContext(context.organizationId);
      return deriveCategoryBudgetMonth({
        month,
        categories: await allCategories(org),
        history: await deps.repository.categoryBudgetHistory.list(org),
        transactions: await deps.listTransactions(org),
      });
    },
    async getBudgetAnnualSummary(context: OrgContext, year: number) {
      const org = requireOrgContext(context.organizationId);
      return deriveCategoryBudgetAnnual({
        year,
        categories: await allCategories(org),
        history: await deps.repository.categoryBudgetHistory.list(org),
        transactions: await deps.listTransactions(org),
      });
    },
    async listCounterparties(context: OrgContext, raw: TreasuryLedgerCatalogQuery = {}) {
      const query = normalizeQuery(raw);
      const rows = await deps.repository.counterparties.list(
        requireOrgContext(context.organizationId),
        query,
      );
      return page(rows, query.limit!, (row) => row.displayName);
    },
    async getCounterparty(context: OrgContext, id: string) {
      const row = await deps.repository.counterparties.get(
        requireOrgContext(context.organizationId),
        id,
      );
      if (!row) throw new TreasuryNotFoundError("counterparty", id);
      return row;
    },
    async createCounterparty(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: TreasuryCounterpartyInput & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      const paymentInstructions = optionalText(
        input.paymentInstructions,
        "paymentInstructions",
        MAX_PAYMENT_TEXT,
      );
      assertNoCustodyOrCardSecret(paymentInstructions, "paymentInstructions");
      const createdAt = now();
      const record: TreasuryCounterpartyRecord = {
        id: newId(),
        organizationId: org.organizationId,
        displayName: requiredText(input.displayName, "displayName"),
        websiteUrl: optionalUrl(input.websiteUrl),
        email: optionalEmail(input.email),
        phone: optionalText(input.phone, "phone", 100),
        paymentInstructions,
        waiaUserId: null,
        waiaUsername:
          optionalText(input.waiaUsername, "waiaUsername", 100)
            ?.replace(/^@/, "")
            .toLocaleLowerCase() ?? null,
        isActive: input.isActive ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      await deps.repository.counterparties.insert(record);
      await audit(
        actor,
        treasuryAuditActions.counterpartyCreate,
        treasuryEntityTypes.counterparty,
        record.id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return record;
    },
    async ensureWaiaUserCounterparty(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        waiaUserId: string;
        displayName: string;
        waiaUsername?: string | null;
        reason: string;
      },
    ) {
      const org = requireOrgContext(context.organizationId);
      const waiaUserId = requiredText(input.waiaUserId, "waiaUserId", 100);
      const displayName = requiredText(input.displayName, "displayName");
      const waiaUsername =
        optionalText(input.waiaUsername, "waiaUsername", 100)
          ?.replace(/^@/, "")
          .toLocaleLowerCase() ?? null;
      const existing = await deps.repository.counterparties.findByWaiaUserId(org, waiaUserId);
      if (existing) {
        const updated = await deps.repository.counterparties.update(org, existing.id, {
          displayName,
          waiaUsername: waiaUsername ?? existing.waiaUsername,
          isActive: true,
          updatedAt: now(),
        });
        await audit(
          actor,
          treasuryAuditActions.counterpartyUpdate,
          treasuryEntityTypes.counterparty,
          existing.id,
          org.organizationId,
          requiredText(input.reason, "reason"),
        );
        return updated;
      }
      const createdAt = now();
      const record: TreasuryCounterpartyRecord = {
        id: newId(),
        organizationId: org.organizationId,
        displayName,
        websiteUrl: null,
        email: null,
        phone: null,
        paymentInstructions: null,
        waiaUserId,
        waiaUsername,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      };
      await deps.repository.counterparties.insert(record);
      await audit(
        actor,
        treasuryAuditActions.counterpartyCreate,
        treasuryEntityTypes.counterparty,
        record.id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return record;
    },
    async updateCounterparty(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      input: Partial<TreasuryCounterpartyInput> & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      const paymentInstructions =
        input.paymentInstructions === undefined
          ? undefined
          : optionalText(input.paymentInstructions, "paymentInstructions", MAX_PAYMENT_TEXT);
      if (paymentInstructions !== undefined)
        assertNoCustodyOrCardSecret(paymentInstructions, "paymentInstructions");
      const patch: Partial<TreasuryCounterpartyRecord> = {
        displayName:
          input.displayName === undefined
            ? undefined
            : requiredText(input.displayName, "displayName"),
        websiteUrl: input.websiteUrl === undefined ? undefined : optionalUrl(input.websiteUrl),
        email: input.email === undefined ? undefined : optionalEmail(input.email),
        phone: input.phone === undefined ? undefined : optionalText(input.phone, "phone", 100),
        paymentInstructions,
        waiaUsername:
          input.waiaUsername === undefined
            ? undefined
            : (optionalText(input.waiaUsername, "waiaUsername", 100)
                ?.replace(/^@/, "")
                .toLocaleLowerCase() ?? null),
        isActive: input.isActive,
        updatedAt: now(),
      };
      const updated = await deps.repository.counterparties.update(org, id, patch);
      await audit(
        actor,
        treasuryAuditActions.counterpartyUpdate,
        treasuryEntityTypes.counterparty,
        id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return updated;
    },

    async listAccounts(context: OrgContext, raw: TreasuryLedgerCatalogQuery = {}) {
      const query = normalizeQuery(raw);
      const rows = await deps.repository.accounts.list(
        requireOrgContext(context.organizationId),
        query,
      );
      return page(rows, query.limit!, (row) => row.displayName);
    },
    async getAccount(context: OrgContext, id: string) {
      const row = await deps.repository.accounts.get(requireOrgContext(context.organizationId), id);
      if (!row) throw new TreasuryNotFoundError("account", id);
      return row;
    },
    async createAccount(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: TreasuryAccountInput & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      if (!treasuryAccountKindEnum.includes(input.kind)) {
        throw new TreasuryValidationError("INVALID_ENUM", "kind is not permitted");
      }
      const maskedRequisites = optionalText(
        input.maskedRequisites,
        "maskedRequisites",
        MAX_PAYMENT_TEXT,
      );
      assertNoCustodyOrCardSecret(maskedRequisites, "maskedRequisites");
      await requireWatchedAddress(org, input.watchedAddressId ?? null);
      const createdAt = now();
      const record: TreasuryAccountRecord = {
        id: newId(),
        organizationId: org.organizationId,
        displayName: requiredText(input.displayName, "displayName"),
        kind: input.kind,
        currency: requiredText(input.currency, "currency", 20).toLocaleUpperCase(),
        network: optionalText(input.network, "network", 100),
        address: optionalText(input.address, "address", 300),
        maskedRequisites,
        watchedAddressId: input.watchedAddressId ?? null,
        isActive: input.isActive ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      await deps.repository.accounts.insert(record);
      await audit(
        actor,
        treasuryAuditActions.accountCreate,
        treasuryEntityTypes.account,
        record.id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return record;
    },
    async updateAccount(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      input: Partial<TreasuryAccountInput> & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      if (input.kind !== undefined && !treasuryAccountKindEnum.includes(input.kind)) {
        throw new TreasuryValidationError("INVALID_ENUM", "kind is not permitted");
      }
      const maskedRequisites =
        input.maskedRequisites === undefined
          ? undefined
          : optionalText(input.maskedRequisites, "maskedRequisites", MAX_PAYMENT_TEXT);
      if (maskedRequisites !== undefined)
        assertNoCustodyOrCardSecret(maskedRequisites, "maskedRequisites");
      if (input.watchedAddressId !== undefined)
        await requireWatchedAddress(org, input.watchedAddressId);
      const updated = await deps.repository.accounts.update(org, id, {
        displayName:
          input.displayName === undefined
            ? undefined
            : requiredText(input.displayName, "displayName"),
        kind: input.kind,
        currency:
          input.currency === undefined
            ? undefined
            : requiredText(input.currency, "currency", 20).toLocaleUpperCase(),
        network:
          input.network === undefined ? undefined : optionalText(input.network, "network", 100),
        address:
          input.address === undefined ? undefined : optionalText(input.address, "address", 300),
        maskedRequisites,
        watchedAddressId: input.watchedAddressId,
        isActive: input.isActive,
        updatedAt: now(),
      });
      await audit(
        actor,
        treasuryAuditActions.accountUpdate,
        treasuryEntityTypes.account,
        id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return updated;
    },

    async listCategories(context: OrgContext, raw: TreasuryLedgerCatalogQuery = {}) {
      const query = normalizeQuery(raw);
      const rows = await deps.repository.categories.list(
        requireOrgContext(context.organizationId),
        query,
      );
      return page(rows, query.limit!, (row) => row.name);
    },
    async getCategory(context: OrgContext, id: string) {
      const row = await deps.repository.categories.get(
        requireOrgContext(context.organizationId),
        id,
      );
      if (!row) throw new TreasuryNotFoundError("category", id);
      return row;
    },
    async createCategory(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: TreasuryCategoryInput & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      if (input.monthlyBudgetMicros < 0n) {
        throw new TreasuryValidationError(
          "INVALID_MONEY",
          "monthlyBudgetMicros cannot be negative",
        );
      }
      const createdAt = now();
      const name = requiredText(input.name, "name");
      const month = effectiveMonth(input.effectiveMonth, createdAt);
      const currency = requiredText(input.currency, "currency", 20).toLocaleUpperCase();
      const record: TreasuryCategoryRecord = {
        id: newId(),
        organizationId: org.organizationId,
        code: await uniqueCategoryCode(org, name),
        name,
        groupName: normalizedGroupName(input.groupName),
        description: optionalText(input.description, "description", 2_000),
        monthlyBudgetMicros: input.monthlyBudgetMicros,
        currency,
        isActive: input.isActive ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      await deps.repository.categories.insertWithBudget(
        record,
        budgetHistoryRecord({
          organizationId: org.organizationId,
          categoryId: record.id,
          month,
          groupName: record.groupName,
          amount: record.isActive ? record.monthlyBudgetMicros : 0n,
          currency,
          timestamp: createdAt,
        }),
      );
      await audit(
        actor,
        treasuryAuditActions.categoryCreate,
        treasuryEntityTypes.category,
        record.id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return record;
    },
    async updateCategory(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      input: Partial<TreasuryCategoryInput> & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      const current = await this.getCategory(org, id);
      if (input.code !== undefined && input.code !== current.code) {
        throw new TreasuryValidationError(
          "CATEGORY_CODE_IMMUTABLE",
          "category code is generated by the server and cannot be changed",
        );
      }
      if (input.monthlyBudgetMicros !== undefined && input.monthlyBudgetMicros < 0n) {
        throw new TreasuryValidationError(
          "INVALID_MONEY",
          "monthlyBudgetMicros cannot be negative",
        );
      }
      const updatedAt = now();
      const nextCurrency =
        input.currency === undefined
          ? current.currency
          : requiredText(input.currency, "currency", 20).toLocaleUpperCase();
      const nextMonthly = input.monthlyBudgetMicros ?? current.monthlyBudgetMicros;
      const nextGroupName =
        input.groupName === undefined ? current.groupName : normalizedGroupName(input.groupName);
      const nextActive = input.isActive ?? current.isActive;
      const changesBudget =
        input.monthlyBudgetMicros !== undefined ||
        input.currency !== undefined ||
        input.groupName !== undefined ||
        input.isActive !== undefined;
      const month = changesBudget ? effectiveMonth(input.effectiveMonth, updatedAt) : undefined;
      const updated = await deps.repository.categories.updateWithBudget(
        org,
        id,
        {
          name: input.name === undefined ? undefined : requiredText(input.name, "name"),
          groupName: input.groupName === undefined ? undefined : nextGroupName,
          description:
            input.description === undefined
              ? undefined
              : optionalText(input.description, "description", 2_000),
          monthlyBudgetMicros: input.monthlyBudgetMicros,
          currency: input.currency === undefined ? undefined : nextCurrency,
          isActive: input.isActive,
          updatedAt,
        },
        changesBudget && month
          ? budgetHistoryRecord({
              organizationId: org.organizationId,
              categoryId: id,
              month,
              groupName: nextGroupName,
              amount: nextActive ? nextMonthly : 0n,
              currency: nextCurrency,
              timestamp: updatedAt,
            })
          : undefined,
      );
      await audit(
        actor,
        treasuryAuditActions.categoryUpdate,
        treasuryEntityTypes.category,
        id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return updated;
    },

    async listProjects(context: OrgContext, raw: TreasuryLedgerCatalogQuery = {}) {
      const query = normalizeQuery(raw);
      const rows = await deps.repository.projects.list(
        requireOrgContext(context.organizationId),
        query,
      );
      return page(rows, query.limit!, (row) => row.name);
    },
    async getProject(context: OrgContext, id: string) {
      const row = await deps.repository.projects.get(requireOrgContext(context.organizationId), id);
      if (!row) throw new TreasuryNotFoundError("project", id);
      return row;
    },
    async createProject(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: TreasuryProjectInput & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      const startsOn = optionalDate(input.startsOn, "startsOn");
      const endsOn = optionalDate(input.endsOn, "endsOn");
      if (startsOn && endsOn && endsOn < startsOn) {
        throw new TreasuryValidationError("INVALID_BODY", "endsOn must not precede startsOn");
      }
      const createdAt = now();
      const record: TreasuryProjectRecord = {
        id: newId(),
        organizationId: org.organizationId,
        name: requiredText(input.name, "name"),
        description: optionalText(input.description, "description", 2_000),
        startsOn,
        endsOn,
        isActive: input.isActive ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      await deps.repository.projects.insert(record);
      await audit(
        actor,
        treasuryAuditActions.projectCreate,
        treasuryEntityTypes.project,
        record.id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return record;
    },
    async updateProject(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      input: Partial<TreasuryProjectInput> & { reason: string },
    ) {
      const org = requireOrgContext(context.organizationId);
      const current = await this.getProject(org, id);
      const startsOn =
        input.startsOn === undefined ? current.startsOn : optionalDate(input.startsOn, "startsOn");
      const endsOn =
        input.endsOn === undefined ? current.endsOn : optionalDate(input.endsOn, "endsOn");
      if (startsOn && endsOn && endsOn < startsOn) {
        throw new TreasuryValidationError("INVALID_BODY", "endsOn must not precede startsOn");
      }
      const updated = await deps.repository.projects.update(org, id, {
        name: input.name === undefined ? undefined : requiredText(input.name, "name"),
        description:
          input.description === undefined
            ? undefined
            : optionalText(input.description, "description", 2_000),
        startsOn,
        endsOn,
        isActive: input.isActive,
        updatedAt: now(),
      });
      await audit(
        actor,
        treasuryAuditActions.projectUpdate,
        treasuryEntityTypes.project,
        id,
        org.organizationId,
        requiredText(input.reason, "reason"),
      );
      return updated;
    },
  };
}

export type TreasuryLedgerCatalogService = ReturnType<typeof createTreasuryLedgerCatalogService>;
