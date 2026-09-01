import type postgres from "postgres";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { createPostgresCanonicalDecisionVerificationReceiptPortV2 } from "./canonical-verification-receipt-postgres-v2";
import { createPostgresDee659AuthorityRepositoryV2 } from "./dee659-authority-repository-postgres-v2";
import { HISTORICAL_DATASET_MEMBERSHIP_V2, type HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import { loadPostgresHistoricalForecastInputPitInTransactionV2 } from "./pit-forecast-input-loader-v2";
import { assertHistoricalMarketCycleV2, type HistoricalSealedMarketCycleV2 } from "./modeled-execution-advance-v2";

type IdentityRow = Readonly<{ forecast_id: string; forecast_content_digest_hex: string;
  forecast_authority_content_digest_hex: string;
  knowledge_content_digest_hex: string; dataset_authority_id: string; dataset_authority_digest_hex: string;
  dataset_membership_content_digest_hex: string; dataset_membership_json: HistoricalDatasetMembershipV2;
  pit_anchor: Date | string; symbol: string; partition: string; record_index: number;
  sealed_cycle_json: HistoricalSealedMarketCycleV2; dataset_authority_content_digest_hex: string }>;

/** All cycle source and authority reads use the caller's 0188 SERIALIZABLE transaction. */
export function createHistoricalSimulationProductionCyclePortV2(tx: postgres.Sql) {
  const authorities = createPostgresDee659AuthorityRepositoryV2({ sql: tx,
    verificationReceipts: createPostgresCanonicalDecisionVerificationReceiptPortV2(tx) });
  async function loadExact(input: Readonly<{ organizationId: string; accountId: string; runId: string; cycleId: string;
      partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT"; expectedRecordIndex: number }>) {
      const rows = await tx<IdentityRow[]>`
        SELECT p.forecast_id::text,encode(p.forecast_content_digest,'hex') AS forecast_content_digest_hex,
          p.forecast_authority_content_digest_hex,p.knowledge_content_digest_hex,
          p.dataset_authority_id::text,p.dataset_authority_digest_hex,p.dataset_membership_content_digest_hex,
          p.dataset_membership_json,p.pit_anchor,p.symbol,p.partition,p.record_index,d.sealed_cycle_json,
          d.authority_content_digest_hex AS dataset_authority_content_digest_hex
        FROM trader_historical_forecast_input_pit_v2 p
        JOIN trader_historical_dataset_authority_v2 d ON d.id=p.dataset_authority_id
          AND d.organization_id=p.organization_id AND d.run_id=p.run_id AND d.cycle_id=p.cycle_id
          AND d.dataset_authority_digest_hex=p.dataset_authority_digest_hex
          AND d.membership_content_digest_hex=p.dataset_membership_content_digest_hex
        WHERE p.organization_id=${input.organizationId}::uuid AND p.run_id=${input.runId}
          AND p.cycle_id=${input.cycleId} AND p.partition=${input.partition} AND p.symbol=${input.symbol}
          AND p.record_index=${input.expectedRecordIndex}`;
      if (rows.length !== 1) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:EXACT_CYCLE_NOT_FOUND");
      const row = rows[0]!; const membership = row.dataset_membership_json;
      const { contentDigestHex, ...membershipBody } = membership;
      const pitAnchor = new Date(row.pit_anchor).toISOString();
      if (membership.schemaVersion !== HISTORICAL_DATASET_MEMBERSHIP_V2 ||
          row.partition !== input.partition || row.symbol !== input.symbol || row.record_index !== input.expectedRecordIndex ||
          membership.organizationId !== input.organizationId || membership.cycleId !== input.cycleId ||
          membership.partition !== input.partition || membership.symbol !== input.symbol ||
          membership.recordIndex !== input.expectedRecordIndex ||
          contentDigestHex !== row.dataset_membership_content_digest_hex ||
          contentDigestHex !== computeSemanticSha256Hex(membershipBody)) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:MEMBERSHIP_BINDING");
      }
      assertHistoricalMarketCycleV2(row.sealed_cycle_json, input.cycleId);
      if (row.sealed_cycle_json.closedBar.symbol.replace("/", "") !== input.symbol ||
          row.sealed_cycle_json.closedBar.barCloseTime !== pitAnchor ||
          membership.sealedCycleContentDigestHex !== row.sealed_cycle_json.contentDigestHex ||
          membership.barContentDigestHex !== computeBarContentDigest(row.sealed_cycle_json.closedBar) ||
          row.dataset_authority_content_digest_hex !== computeStableJsonDigest({ organizationId: input.organizationId,
            runId: input.runId, membership, sealedCycle: row.sealed_cycle_json })) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CYCLE_BINDING");
      }
      const authorityRows = await tx<{ dee659_preregistration_id: string;
        dee659_bundle_content_digest_hex: string }[]>`
        SELECT b.dee659_preregistration_id::text,
          p.authority_bundle_digest_hex AS dee659_bundle_content_digest_hex
        FROM trader_dee659_authority_bundle_v2 b
        JOIN trader_dee659_authority_preregistration_v2 p
          ON p.id=b.dee659_preregistration_id AND p.organization_id=b.organization_id
          AND p.account_id=b.account_id AND p.run_id=b.run_id AND p.cycle_id=b.cycle_id
          AND p.forecast_id::text=b.forecast_id AND p.dataset_authority_digest_hex=b.dataset_authority_digest_hex
        WHERE b.organization_id=${input.organizationId}::uuid AND b.account_id=${input.accountId}
          AND b.run_id=${input.runId} AND b.cycle_id=${input.cycleId}
          AND b.forecast_id=${row.forecast_id}
          AND b.forecast_authority_content_digest_hex=${row.forecast_authority_content_digest_hex}
          AND b.dataset_authority_digest_hex=${row.dataset_authority_digest_hex}
          AND b.pit_anchor=${pitAnchor}::timestamptz`;
      if (authorityRows.length !== 1) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DEE659_AUTHORITY_NOT_FOUND");
      }
      const authorityRow = authorityRows[0]!;
      const forecastInput = await loadPostgresHistoricalForecastInputPitInTransactionV2(tx, {
        organizationId: input.organizationId, runId: input.runId, cycleId: input.cycleId,
        forecastId: row.forecast_id, symbol: input.symbol, pitAnchor,
        knowledgeContentDigestHex: row.knowledge_content_digest_hex,
        forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex,
        datasetAuthorityId: row.dataset_authority_id,
      });
      const decisionAuthorities = await authorities.load({ organizationId: input.organizationId,
        accountId: input.accountId, cycleId: input.cycleId,
        forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex });
      if (decisionAuthorities.forecastId !== row.forecast_id) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:AUTHORITY_BINDING");
      }
      const verificationRows = await tx<{ id: string }[]>`
        SELECT id::text FROM trader_canonical_decision_verification_receipt_v2
        WHERE organization_id=${input.organizationId}::uuid AND (account_id IS NULL OR account_id=${input.accountId})
          AND verification_receipt_digest_hex=${decisionAuthorities.forecastVerificationReceiptDigestHex}
          AND verified=true`;
      if (verificationRows.length !== 1 || !verificationRows[0]!.id?.trim()) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:VERIFICATION_RECEIPT_IDENTITY");
      }
      return Object.freeze({ membership, sealedCycle: row.sealed_cycle_json, forecastInput,
        forecastId: row.forecast_id, forecastContentDigestHex: row.forecast_content_digest_hex,
        forecastAuthorityContentDigestHex: row.forecast_authority_content_digest_hex,
        knowledgeContentDigestHex: row.knowledge_content_digest_hex, datasetAuthorityId: row.dataset_authority_id,
        datasetAuthorityDigestHex: row.dataset_authority_digest_hex, pitAnchor,
        dee659PreregistrationId: authorityRow.dee659_preregistration_id,
        dee659BundleContentDigestHex: authorityRow.dee659_bundle_content_digest_hex,
        canonicalVerificationReceiptId: verificationRows[0]!.id, decisionAuthorities });
    }
  return Object.freeze({ loadExact,
    async loadNextExact(input: Readonly<{ organizationId: string; accountId: string; runId: string;
      partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
      expectedRecordIndex: number }>) {
      const identities = await tx<{ cycle_id: string }[]>`
        SELECT cycle_id FROM trader_historical_forecast_input_pit_v2
        WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
          AND partition=${input.partition} AND symbol=${input.symbol} AND record_index=${input.expectedRecordIndex}`;
      if (identities.length !== 1) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:NEXT_CYCLE_IDENTITY");
      }
      return loadExact({ ...input, cycleId: identities[0]!.cycle_id });
    } });
}
