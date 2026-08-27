import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  type ForecastInputContractV2,
  type ForecastModelArtifactV2,
  type ForecastModelSpecV2,
  requireForecastInputContractV2,
  requireForecastModelArtifactV2,
  requireForecastModelSpecV2,
} from "./forecast-contract-foundation-v2";
import { assertDigestHex64, assertUuidRfc4122 } from "./scientific-identity-validators-v1";

export const FORECAST_CONTRACT_BINDING_V1_VERSION =
  "waia.trader.forecast_contract_binding.v1" as const;

export type ForecastContractBindingV1 = Readonly<{
  schemaVersion: typeof FORECAST_CONTRACT_BINDING_V1_VERSION;
  organizationId: string;
  scientificAdmissionReceiptId: string;
  scientificAdmissionReceiptContentDigestHex: string;
  selectedPredictivePackageContentDigestHex: string;
  inputContract: ForecastInputContractV2;
  modelSpec: ForecastModelSpecV2;
  modelArtifact: ForecastModelArtifactV2;
  bindingSemanticDigestHex: string;
  contentDigestHex: string;
}>;

export type ForecastContractBindingRecordV1 = Readonly<{
  id: string;
  binding: ForecastContractBindingV1;
  bindingJson: string;
}>;

export class ForecastContractBindingConflictError extends Error {
  readonly code = "FORECAST_CONTRACT_BINDING_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ForecastContractBindingConflictError";
  }
}

function bindingBody(
  binding: Omit<ForecastContractBindingV1, "contentDigestHex">,
): Omit<ForecastContractBindingV1, "contentDigestHex"> {
  return binding;
}

export function buildForecastContractBindingV1(input: {
  organizationId: string;
  scientificAdmissionReceiptId: string;
  scientificAdmissionReceiptContentDigestHex: string;
  selectedPredictivePackageContentDigestHex: string;
  inputContract: ForecastInputContractV2;
  modelSpec: ForecastModelSpecV2;
  modelArtifact: ForecastModelArtifactV2;
}): ForecastContractBindingV1 {
  assertUuidRfc4122(input.organizationId, "organizationId");
  assertUuidRfc4122(input.scientificAdmissionReceiptId, "scientificAdmissionReceiptId");
  assertDigestHex64(
    input.scientificAdmissionReceiptContentDigestHex,
    "scientificAdmissionReceiptContentDigestHex",
  );
  assertDigestHex64(
    input.selectedPredictivePackageContentDigestHex,
    "selectedPredictivePackageContentDigestHex",
  );
  const inputContract = requireForecastInputContractV2(input.inputContract);
  const modelSpec = requireForecastModelSpecV2(input.modelSpec);
  const modelArtifact = requireForecastModelArtifactV2(input.modelArtifact);
  if (
    modelSpec.inputContractDigestHex !== inputContract.contentDigestHex ||
    modelArtifact.inputContractDigestHex !== inputContract.contentDigestHex ||
    modelArtifact.modelSpecDigestHex !== modelSpec.contentDigestHex
  ) {
    throw new Error("FORECAST_CONTRACT_BINDING_INVALID:contractGraphMismatch");
  }
  const bindingSemanticDigestHex = computeSemanticSha256Hex({
    schemaVersion: FORECAST_CONTRACT_BINDING_V1_VERSION,
    organizationId: input.organizationId,
    selectedPredictivePackageContentDigestHex: input.selectedPredictivePackageContentDigestHex,
  });
  const body = bindingBody({
    schemaVersion: FORECAST_CONTRACT_BINDING_V1_VERSION,
    organizationId: input.organizationId,
    scientificAdmissionReceiptId: input.scientificAdmissionReceiptId,
    scientificAdmissionReceiptContentDigestHex:
      input.scientificAdmissionReceiptContentDigestHex,
    selectedPredictivePackageContentDigestHex: input.selectedPredictivePackageContentDigestHex,
    inputContract,
    modelSpec,
    modelArtifact,
    bindingSemanticDigestHex,
  });
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

export function requireForecastContractBindingV1(
  binding: ForecastContractBindingV1,
): ForecastContractBindingV1 {
  const rebuilt = buildForecastContractBindingV1({
    organizationId: binding.organizationId,
    scientificAdmissionReceiptId: binding.scientificAdmissionReceiptId,
    scientificAdmissionReceiptContentDigestHex:
      binding.scientificAdmissionReceiptContentDigestHex,
    selectedPredictivePackageContentDigestHex:
      binding.selectedPredictivePackageContentDigestHex,
    inputContract: binding.inputContract,
    modelSpec: binding.modelSpec,
    modelArtifact: binding.modelArtifact,
  });
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(binding)) {
    throw new Error("FORECAST_CONTRACT_BINDING_INVALID:digestOrSemantics");
  }
  return binding;
}

export function buildForecastContractBindingRecordV1(
  input: Parameters<typeof buildForecastContractBindingV1>[0],
): ForecastContractBindingRecordV1 {
  const binding = buildForecastContractBindingV1(input);
  return { id: randomUUID(), binding, bindingJson: canonicalizeSemanticJsonString(binding) };
}

type StoredBindingRow = {
  id: string;
  binding_json: string;
  content_digest: string;
};

function decodeStoredBinding(row: StoredBindingRow): ForecastContractBindingV1 {
  const binding = JSON.parse(row.binding_json) as ForecastContractBindingV1;
  if (binding.contentDigestHex !== row.content_digest) {
    throw new Error("FORECAST_CONTRACT_BINDING_DURABLE_CONTENT_MISMATCH");
  }
  requireForecastContractBindingV1(binding);
  if (canonicalizeSemanticJsonString(binding) !== row.binding_json) {
    throw new Error("FORECAST_CONTRACT_BINDING_DURABLE_JSON_NON_CANONICAL");
  }
  return binding;
}

export async function persistForecastContractBindingV1(
  sql: postgres.Sql,
  record: ForecastContractBindingRecordV1,
): Promise<{ id: string; insertedNew: boolean }> {
  const binding = requireForecastContractBindingV1(record.binding);
  if (canonicalizeSemanticJsonString(binding) !== record.bindingJson) {
    throw new Error("FORECAST_CONTRACT_BINDING_RECORD_JSON_MISMATCH");
  }
  const receipts = await sql<
    { id: string; content_digest: string; selected_package_content_digest: string | null }[]
  >`
    SELECT id::text AS id, content_digest, selected_package_content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, binding.organizationId)}
      AND id = ${binding.scientificAdmissionReceiptId}::uuid
      AND schema_version = 'scientific-admission-receipt/v2'
  `;
  const receipt = receipts[0];
  if (
    receipts.length !== 1 ||
    receipt?.content_digest !== binding.scientificAdmissionReceiptContentDigestHex ||
    receipt.selected_package_content_digest !==
      binding.selectedPredictivePackageContentDigestHex
  ) {
    throw new Error("FORECAST_CONTRACT_BINDING_SCIENTIFIC_ADMISSION_MISMATCH");
  }
  const existing = await sql<StoredBindingRow[]>`
    SELECT id::text AS id, binding_json, content_digest
    FROM trader_forecast_contract_binding_v1
    WHERE ${orgScopedPostgresPredicate(sql, binding.organizationId)}
      AND selected_predictive_package_content_digest =
        ${binding.selectedPredictivePackageContentDigestHex}
  `;
  if (existing[0]) {
    const durable = decodeStoredBinding(existing[0]);
    if (durable.contentDigestHex !== binding.contentDigestHex) {
      throw new ForecastContractBindingConflictError(
        "FORECAST_CONTRACT_BINDING_NATURAL_IDENTITY_CONFLICT",
      );
    }
    return { id: existing[0].id, insertedNew: false };
  }
  try {
    await sql`
      INSERT INTO trader_forecast_contract_binding_v1 (
        id, organization_id, scientific_admission_receipt_id,
        scientific_admission_receipt_content_digest,
        selected_predictive_package_content_digest, input_contract_digest,
        model_spec_digest, model_artifact_digest, binding_semantic_digest,
        binding_json, content_digest, schema_version
      ) VALUES (
        ${record.id}::uuid, ${binding.organizationId}::uuid,
        ${binding.scientificAdmissionReceiptId}::uuid,
        ${binding.scientificAdmissionReceiptContentDigestHex},
        ${binding.selectedPredictivePackageContentDigestHex},
        ${binding.inputContract.contentDigestHex}, ${binding.modelSpec.contentDigestHex},
        ${binding.modelArtifact.contentDigestHex}, ${binding.bindingSemanticDigestHex},
        ${record.bindingJson}, ${binding.contentDigestHex}, ${binding.schemaVersion}
      )
    `;
  } catch (error) {
    const raced = await sql<StoredBindingRow[]>`
      SELECT id::text AS id, binding_json, content_digest
      FROM trader_forecast_contract_binding_v1
      WHERE ${orgScopedPostgresPredicate(sql, binding.organizationId)}
        AND selected_predictive_package_content_digest =
          ${binding.selectedPredictivePackageContentDigestHex}
    `;
    if (raced[0]) {
      const durable = decodeStoredBinding(raced[0]);
      if (durable.contentDigestHex === binding.contentDigestHex) {
        return { id: raced[0].id, insertedNew: false };
      }
      throw new ForecastContractBindingConflictError(
        "FORECAST_CONTRACT_BINDING_NATURAL_IDENTITY_CONFLICT",
      );
    }
    throw error;
  }
  return { id: record.id, insertedNew: true };
}

export async function readForecastContractBindingV1(
  sql: postgres.Sql,
  input: { organizationId: string; selectedPredictivePackageContentDigestHex: string },
): Promise<ForecastContractBindingV1 | null> {
  assertUuidRfc4122(input.organizationId, "organizationId");
  assertDigestHex64(
    input.selectedPredictivePackageContentDigestHex,
    "selectedPredictivePackageContentDigestHex",
  );
  const rows = await sql<StoredBindingRow[]>`
    SELECT id::text AS id, binding_json, content_digest
    FROM trader_forecast_contract_binding_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND selected_predictive_package_content_digest =
        ${input.selectedPredictivePackageContentDigestHex}
  `;
  if (rows.length > 1) throw new Error("FORECAST_CONTRACT_BINDING_DURABLE_AMBIGUOUS");
  return rows[0] ? decodeStoredBinding(rows[0]) : null;
}

export type ForecastContractAdmissionV1 =
  | Readonly<{ status: "ADMITTED"; binding: ForecastContractBindingV1 }>
  | Readonly<{
      status: "NOT_ADMITTED";
      reason: "MISSING_FORECAST_CONTRACT_BINDING" | "FORECAST_CONTRACT_BINDING_MISMATCH";
    }>;

export async function assessForecastContractAdmissionV1(
  sql: postgres.Sql,
  expected: {
    organizationId: string;
    selectedPredictivePackageContentDigestHex: string;
    inputContractDigestHex: string;
    modelSpecDigestHex: string;
    modelArtifactDigestHex: string;
  },
): Promise<ForecastContractAdmissionV1> {
  const binding = await readForecastContractBindingV1(sql, expected);
  if (!binding) return { status: "NOT_ADMITTED", reason: "MISSING_FORECAST_CONTRACT_BINDING" };
  if (
    binding.inputContract.contentDigestHex !== expected.inputContractDigestHex ||
    binding.modelSpec.contentDigestHex !== expected.modelSpecDigestHex ||
    binding.modelArtifact.contentDigestHex !== expected.modelArtifactDigestHex
  ) {
    return { status: "NOT_ADMITTED", reason: "FORECAST_CONTRACT_BINDING_MISMATCH" };
  }
  return { status: "ADMITTED", binding };
}
