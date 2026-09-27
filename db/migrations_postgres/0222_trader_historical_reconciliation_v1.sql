-- R2: ordinary nullable projections; old rows are neither scanned nor backfilled.
ALTER TABLE public.trader_historical_simulation_durable_snapshot_v2 ADD COLUMN reconciliation_projection_v1 pg_catalog.jsonb;
--> statement-breakpoint
ALTER TABLE public.trader_historical_simulation_durable_snapshot_v2 ADD CONSTRAINT historical_reconciliation_durable_snapshot_projection_v1
CHECK (CASE WHEN reconciliation_projection_v1 IS NULL THEN true ELSE
  (CASE WHEN pg_catalog.jsonb_typeof(reconciliation_projection_v1)='object'
    AND pg_catalog.octet_length(reconciliation_projection_v1::pg_catalog.text)<=1048576
    AND 14::pg_catalog.int8*pg_catalog.octet_length(reconciliation_projection_v1::pg_catalog.text)+65536<=8388608
    AND CASE state_kind WHEN 'ACCOUNTING_FRONTIER' THEN true WHEN 'MODELED_EXCHANGE' THEN true ELSE false END
    AND pg_catalog.jsonb_path_query_first(reconciliation_projection_v1,
        'strict $.value.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb
  THEN (reconciliation_projection_v1::pg_catalog.text COLLATE pg_catalog."C")=((pg_catalog.jsonb_build_object('schemaVersion',
        1,
        'organizationId',
        organization_id::pg_catalog.text,
        'accountId',
        account_id,
        'runId',
        run_id,
        'cycleSequence',
        cycle_sequence,
        'cycleId',
        cycle_id,
        'kind',
        state_kind,
        'ledgerEntryId',
        ledger_entry_id,
        'ledgerDigest',
        ledger_entry_content_digest_hex,
        'sourceSchema',
        schema_version,
        'sourceDigest',
        snapshot_content_digest_hex,
        'value',
        CASE state_kind WHEN 'ACCOUNTING_FRONTIER' THEN (CASE WHEN (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.id.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.semanticContentDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.accountingSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.sourceFillId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.sourceEconomicsDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.organizationId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.accountKey.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.runId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.cash.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds.type()',
        '{}'::pg_catalog.jsonb,
        true)='"array"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (NOT (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) IS TRUE) AND ((pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.quantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.grossPositionBasis.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.netPositionBasis.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))) AND ((pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.quantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.grossPositionBasis.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.netPositionBasis.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))) AND ((pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds.size()',
        '{}'::pg_catalog.jsonb,
        true)='0'::pg_catalog.jsonb OR (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds[last].type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))) THEN (CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions',
        '{}'::pg_catalog.jsonb,
        true)=pg_catalog.jsonb_path_query_first(reconciliation_projection_v1,
        'strict $.value.positionBasis',
        '{}'::pg_catalog.jsonb,
        true) THEN pg_catalog.jsonb_build_object('accounting',
        pg_catalog.jsonb_build_object('id',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.id',
        '{}'::pg_catalog.jsonb,
        true),
        'digest',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.semanticContentDigest',
        '{}'::pg_catalog.jsonb,
        true),
        'sequence',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.accountingSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceFillId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.sourceFillId',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsDigest',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.sourceEconomicsDigest',
        '{}'::pg_catalog.jsonb,
        true),
        'organizationId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.organizationId',
        '{}'::pg_catalog.jsonb,
        true),
        'accountId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.accountKey',
        '{}'::pg_catalog.jsonb,
        true),
        'runId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.runId',
        '{}'::pg_catalog.jsonb,
        true),
        'cash',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.cash',
        '{}'::pg_catalog.jsonb,
        true),
        'positions',
        ((CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb THEN pg_catalog.jsonb_build_object('BTCUSDT',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.quantity',
        '{}'::pg_catalog.jsonb,
        true)) ELSE '{}'::pg_catalog.jsonb END)||(CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb THEN pg_catalog.jsonb_build_object('ETHUSDT',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.quantity',
        '{}'::pg_catalog.jsonb,
        true)) ELSE '{}'::pg_catalog.jsonb END)),
        'consumedFillCount',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds.size()',
        '{}'::pg_catalog.jsonb,
        true),
        'lastConsumedFillId',
        (CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds.size()',
        '{}'::pg_catalog.jsonb,
        true)='0'::pg_catalog.jsonb THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_path_query_first(state_json,
        'strict $.consumedFillIds[last]',
        '{}'::pg_catalog.jsonb,
        true) END)),
        'positionBasis',
        ((CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb THEN pg_catalog.jsonb_build_object('BTCUSDT',
        pg_catalog.jsonb_build_object('quantity',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.quantity',
        '{}'::pg_catalog.jsonb,
        true),
        'grossPositionBasis',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.grossPositionBasis',
        '{}'::pg_catalog.jsonb,
        true),
        'netPositionBasis',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.BTCUSDT.netPositionBasis',
        '{}'::pg_catalog.jsonb,
        true))) ELSE '{}'::pg_catalog.jsonb END)||(CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb THEN pg_catalog.jsonb_build_object('ETHUSDT',
        pg_catalog.jsonb_build_object('quantity',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.quantity',
        '{}'::pg_catalog.jsonb,
        true),
        'grossPositionBasis',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.grossPositionBasis',
        '{}'::pg_catalog.jsonb,
        true),
        'netPositionBasis',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.positions.ETHUSDT.netPositionBasis',
        '{}'::pg_catalog.jsonb,
        true))) ELSE '{}'::pg_catalog.jsonb END))) ELSE NULL::pg_catalog.jsonb END) ELSE NULL::pg_catalog.jsonb END) WHEN 'MODELED_EXCHANGE' THEN (CASE WHEN (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.type()',
        '{}'::pg_catalog.jsonb,
        true)='"array"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders.type()',
        '{}'::pg_catalog.jsonb,
        true)='"array"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true) IN ('0'::pg_catalog.jsonb,
        '1'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true)=pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true)) AND ((pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true)='0'::pg_catalog.jsonb OR (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].id.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].state.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].stateVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].filledQuantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].orderId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].acceptedAtTs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].firstEligibleTs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].sameSymbolEligibleBarsSeen.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].remainingQty.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].filledQty.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].fillSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND ((pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) OR (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.requestedAtTs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.cancelEffectiveTs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))))) THEN pg_catalog.jsonb_build_object('orders',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true),
        'entries',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true),
        'parent',
        (CASE WHEN pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders.size()',
        '{}'::pg_catalog.jsonb,
        true)='0'::pg_catalog.jsonb THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_build_object('orderId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].id',
        '{}'::pg_catalog.jsonb,
        true),
        'state',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].state',
        '{}'::pg_catalog.jsonb,
        true),
        'stateVersion',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].stateVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'filledQuantity',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.openOrders[0].filledQuantity',
        '{}'::pg_catalog.jsonb,
        true),
        'entryOrderId',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].acceptedAtTs',
        '{}'::pg_catalog.jsonb,
        true),
        'firstEligibleAt',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].firstEligibleTs',
        '{}'::pg_catalog.jsonb,
        true),
        'eligibleBarsSeen',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].sameSymbolEligibleBarsSeen',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantity',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].remainingQty',
        '{}'::pg_catalog.jsonb,
        true),
        'entryFilledQuantity',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].filledQty',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'pendingCancel',
        (CASE WHEN (pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_build_object('requestedAtTs',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.requestedAtTs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelEffectiveTs',
        pg_catalog.jsonb_path_query_first(state_json,
        'strict $.checkpoint.openOrders[0].pendingCancel.cancelEffectiveTs',
        '{}'::pg_catalog.jsonb,
        true)) END)) END)) ELSE NULL::pg_catalog.jsonb END) ELSE NULL::pg_catalog.jsonb END))::pg_catalog.text COLLATE pg_catalog."C") ELSE false END) IS TRUE END) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.trader_historical_simulation_atomic_stage_v2 ADD COLUMN reconciliation_projection_v1 pg_catalog.jsonb;
--> statement-breakpoint
ALTER TABLE public.trader_historical_simulation_atomic_stage_v2 ADD CONSTRAINT historical_reconciliation_atomic_stage_projection_v1
CHECK (CASE WHEN reconciliation_projection_v1 IS NULL THEN true ELSE
  (CASE WHEN pg_catalog.jsonb_typeof(reconciliation_projection_v1)='object'
    AND pg_catalog.octet_length(reconciliation_projection_v1::pg_catalog.text)<=1048576
    AND 14::pg_catalog.int8*pg_catalog.octet_length(reconciliation_projection_v1::pg_catalog.text)+65536<=8388608
    AND CASE stage WHEN 'ACCOUNTING' THEN true WHEN 'OBSERVED_EXECUTION_EFFECTS' THEN true ELSE false END
    AND pg_catalog.jsonb_path_query_first(reconciliation_projection_v1,
        'strict $.value.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb
  THEN (reconciliation_projection_v1::pg_catalog.text COLLATE pg_catalog."C")=((pg_catalog.jsonb_build_object('schemaVersion',
        1,
        'organizationId',
        organization_id::pg_catalog.text,
        'accountId',
        account_id,
        'runId',
        run_id,
        'cycleSequence',
        cycle_sequence,
        'cycleId',
        cycle_id,
        'kind',
        stage,
        'ledgerEntryId',
        ledger_entry_id,
        'ledgerDigest',
        ledger_entry_content_digest_hex,
        'sourceSchema',
        schema_version,
        'sourceDigest',
        bundle_content_digest_hex,
        'value',
        CASE stage WHEN 'ACCOUNTING' THEN (CASE WHEN (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.type()',
        '{}'::pg_catalog.jsonb,
        true)='"array"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true)='1'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].contentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind',
        '{}'::pg_catalog.jsonb,
        true)='"ACCOUNTING_FRONTIER"'::pg_catalog.jsonb) THEN (CASE WHEN pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0]',
        '{}'::pg_catalog.jsonb,
        true)=pg_catalog.jsonb_path_query_first(reconciliation_projection_v1,
        'strict $.value.artifact',
        '{}'::pg_catalog.jsonb,
        true) THEN pg_catalog.jsonb_build_object('artifactCount',
        1,
        'artifact',
        pg_catalog.jsonb_build_object('artifactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'artifactId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactId',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true))) ELSE NULL::pg_catalog.jsonb END) ELSE NULL::pg_catalog.jsonb END) WHEN 'OBSERVED_EXECUTION_EFFECTS' THEN (CASE WHEN (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.type()',
        '{}'::pg_catalog.jsonb,
        true)='"array"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true) IN ('1'::pg_catalog.jsonb,
        '2'::pg_catalog.jsonb)) AND ((pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true)='0'::pg_catalog.jsonb OR (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].contentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND ((pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) OR (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.orderId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.organizationId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.side.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBarIndex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.grossFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sliceQuantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.remainingQuantityAfter.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.acceptedAt.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.submitLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.cancelLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.interval.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.open.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.high.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.low.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.close.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.volume.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barOpenTime.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barCloseTime.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionFactKind.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossNotional.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAmount.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAsset.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.spreadCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.impactSlippageCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.totalExecutionCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netCashEffect.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.economicsContentDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelSchemaVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarIndex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.acceptedAt.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.submitLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.cancelLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.remainingQuantityAfter.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.side.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.quantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.schemaVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.source.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.capitalEligible.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.cycleId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.sealedMarketCycleContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.orderId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.fillId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.economicsContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.accountingFrontierContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.contentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.id.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.semanticContentDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))))) AND ((pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true)='1'::pg_catalog.jsonb OR (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].artifactKind.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].artifactId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].contentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND ((pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) OR (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.orderId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.organizationId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.side.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.fillSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBarIndex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.grossFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sliceQuantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.remainingQuantityAfter.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.acceptedAt.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.fillTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.submitLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.cancelLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.interval.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.open.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.high.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.low.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.close.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.volume.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.barOpenTime.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.barCloseTime.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionFactKind.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.grossFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.grossNotional.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.feeAmount.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.feeAsset.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.spreadCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.impactSlippageCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.totalExecutionCost.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.netFillPrice.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.netCashEffect.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.economicsContentDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionModelId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionModelSchemaVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.simulatorId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.simulatorVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.sourceBarTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.sourceBarIndex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.acceptedAt.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.fillTimestamp.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.submitLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.cancelLatencyMs.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.remainingQuantityAfter.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.fillSequence.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.symbol.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.side.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.quantity.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.schemaVersion.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.source.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.capitalEligible.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.cycleId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.sealedMarketCycleContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.orderId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.fillId.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.economicsContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.accountingFrontierContentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.contentDigestHex.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.accountingFrontier.id.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb) AND pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.accountingFrontier.semanticContentDigest.type()',
        '{}'::pg_catalog.jsonb,
        true) IN ('"string"'::pg_catalog.jsonb,
        '"number"'::pg_catalog.jsonb,
        '"boolean"'::pg_catalog.jsonb,
        '"null"'::pg_catalog.jsonb)))))) AND (NOT ((pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb) AND (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"object"'::pg_catalog.jsonb)) IS TRUE) THEN pg_catalog.jsonb_build_object('artifactCount',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true),
        'artifacts',
        (CASE WHEN pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $.size()',
        '{}'::pg_catalog.jsonb,
        true)='1'::pg_catalog.jsonb THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('artifactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'artifactId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactId',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'detail',
        (CASE WHEN (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_build_object('event',
        pg_catalog.jsonb_build_object('orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'organizationId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.organizationId',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.side',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'sliceQuantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sliceQuantity',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBar',
        pg_catalog.jsonb_build_object('symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'interval',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.interval',
        '{}'::pg_catalog.jsonb,
        true),
        'open',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.open',
        '{}'::pg_catalog.jsonb,
        true),
        'high',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.high',
        '{}'::pg_catalog.jsonb,
        true),
        'low',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.low',
        '{}'::pg_catalog.jsonb,
        true),
        'close',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.close',
        '{}'::pg_catalog.jsonb,
        true),
        'volume',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.volume',
        '{}'::pg_catalog.jsonb,
        true),
        'barOpenTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barOpenTime',
        '{}'::pg_catalog.jsonb,
        true),
        'barCloseTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barCloseTime',
        '{}'::pg_catalog.jsonb,
        true))),
        'economics',
        pg_catalog.jsonb_build_object('executionFactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionFactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'grossNotional',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossNotional',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAmount',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAmount',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAsset',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAsset',
        '{}'::pg_catalog.jsonb,
        true),
        'spreadCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.spreadCost',
        '{}'::pg_catalog.jsonb,
        true),
        'impactSlippageCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.impactSlippageCost',
        '{}'::pg_catalog.jsonb,
        true),
        'totalExecutionCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.totalExecutionCost',
        '{}'::pg_catalog.jsonb,
        true),
        'netFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'netCashEffect',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netCashEffect',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.economicsContentDigest',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelId',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelSchemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelSchemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorId',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.side',
        '{}'::pg_catalog.jsonb,
        true),
        'quantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.quantity',
        '{}'::pg_catalog.jsonb,
        true)),
        'evidence',
        pg_catalog.jsonb_build_object('schemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.schemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'source',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.source',
        '{}'::pg_catalog.jsonb,
        true),
        'capitalEligible',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.capitalEligible',
        '{}'::pg_catalog.jsonb,
        true),
        'cycleId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.cycleId',
        '{}'::pg_catalog.jsonb,
        true),
        'sealedMarketCycleContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.sealedMarketCycleContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'fillId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.fillId',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.economicsContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingFrontierContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.accountingFrontierContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true)),
        'accountingId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.id',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.semanticContentDigest',
        '{}'::pg_catalog.jsonb,
        true)) END))) ELSE pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('artifactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'artifactId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].artifactId',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'detail',
        (CASE WHEN (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_build_object('event',
        pg_catalog.jsonb_build_object('orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'organizationId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.organizationId',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.side',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'sliceQuantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sliceQuantity',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBar',
        pg_catalog.jsonb_build_object('symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'interval',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.interval',
        '{}'::pg_catalog.jsonb,
        true),
        'open',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.open',
        '{}'::pg_catalog.jsonb,
        true),
        'high',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.high',
        '{}'::pg_catalog.jsonb,
        true),
        'low',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.low',
        '{}'::pg_catalog.jsonb,
        true),
        'close',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.close',
        '{}'::pg_catalog.jsonb,
        true),
        'volume',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.volume',
        '{}'::pg_catalog.jsonb,
        true),
        'barOpenTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barOpenTime',
        '{}'::pg_catalog.jsonb,
        true),
        'barCloseTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.event.sourceBar.barCloseTime',
        '{}'::pg_catalog.jsonb,
        true))),
        'economics',
        pg_catalog.jsonb_build_object('executionFactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionFactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'grossNotional',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.grossNotional',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAmount',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAmount',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAsset',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.feeAsset',
        '{}'::pg_catalog.jsonb,
        true),
        'spreadCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.spreadCost',
        '{}'::pg_catalog.jsonb,
        true),
        'impactSlippageCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.impactSlippageCost',
        '{}'::pg_catalog.jsonb,
        true),
        'totalExecutionCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.totalExecutionCost',
        '{}'::pg_catalog.jsonb,
        true),
        'netFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'netCashEffect',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.netCashEffect',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.economicsContentDigest',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelId',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelSchemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.executionModelSchemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorId',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.simulatorVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.side',
        '{}'::pg_catalog.jsonb,
        true),
        'quantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.economics.quantity',
        '{}'::pg_catalog.jsonb,
        true)),
        'evidence',
        pg_catalog.jsonb_build_object('schemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.schemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'source',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.source',
        '{}'::pg_catalog.jsonb,
        true),
        'capitalEligible',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.capitalEligible',
        '{}'::pg_catalog.jsonb,
        true),
        'cycleId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.cycleId',
        '{}'::pg_catalog.jsonb,
        true),
        'sealedMarketCycleContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.sealedMarketCycleContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'fillId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.fillId',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.economicsContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingFrontierContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.accountingFrontierContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.evidence.contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true)),
        'accountingId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.id',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[0].payload.lineagePayload.fillDetail.accountingFrontier.semanticContentDigest',
        '{}'::pg_catalog.jsonb,
        true)) END)),
        pg_catalog.jsonb_build_object('artifactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].artifactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'artifactId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].artifactId',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'detail',
        (CASE WHEN (pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true) IS NULL OR pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.type()',
        '{}'::pg_catalog.jsonb,
        true)='"null"'::pg_catalog.jsonb) THEN 'null'::pg_catalog.jsonb ELSE pg_catalog.jsonb_build_object('event',
        pg_catalog.jsonb_build_object('orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'organizationId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.organizationId',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.side',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'sliceQuantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sliceQuantity',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBar',
        pg_catalog.jsonb_build_object('symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'interval',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.interval',
        '{}'::pg_catalog.jsonb,
        true),
        'open',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.open',
        '{}'::pg_catalog.jsonb,
        true),
        'high',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.high',
        '{}'::pg_catalog.jsonb,
        true),
        'low',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.low',
        '{}'::pg_catalog.jsonb,
        true),
        'close',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.close',
        '{}'::pg_catalog.jsonb,
        true),
        'volume',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.volume',
        '{}'::pg_catalog.jsonb,
        true),
        'barOpenTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.barOpenTime',
        '{}'::pg_catalog.jsonb,
        true),
        'barCloseTime',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.event.sourceBar.barCloseTime',
        '{}'::pg_catalog.jsonb,
        true))),
        'economics',
        pg_catalog.jsonb_build_object('executionFactKind',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionFactKind',
        '{}'::pg_catalog.jsonb,
        true),
        'grossFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.grossFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'grossNotional',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.grossNotional',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAmount',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.feeAmount',
        '{}'::pg_catalog.jsonb,
        true),
        'feeAsset',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.feeAsset',
        '{}'::pg_catalog.jsonb,
        true),
        'spreadCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.spreadCost',
        '{}'::pg_catalog.jsonb,
        true),
        'impactSlippageCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.impactSlippageCost',
        '{}'::pg_catalog.jsonb,
        true),
        'totalExecutionCost',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.totalExecutionCost',
        '{}'::pg_catalog.jsonb,
        true),
        'netFillPrice',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.netFillPrice',
        '{}'::pg_catalog.jsonb,
        true),
        'netCashEffect',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.netCashEffect',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.economicsContentDigest',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionModelId',
        '{}'::pg_catalog.jsonb,
        true),
        'executionModelSchemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.executionModelSchemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.simulatorId',
        '{}'::pg_catalog.jsonb,
        true),
        'simulatorVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.simulatorVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.sourceBarTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'sourceBarIndex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.sourceBarIndex',
        '{}'::pg_catalog.jsonb,
        true),
        'acceptedAt',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.acceptedAt',
        '{}'::pg_catalog.jsonb,
        true),
        'fillTimestamp',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.fillTimestamp',
        '{}'::pg_catalog.jsonb,
        true),
        'submitLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.submitLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'cancelLatencyMs',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.cancelLatencyMs',
        '{}'::pg_catalog.jsonb,
        true),
        'remainingQuantityAfter',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.remainingQuantityAfter',
        '{}'::pg_catalog.jsonb,
        true),
        'fillSequence',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.fillSequence',
        '{}'::pg_catalog.jsonb,
        true),
        'symbol',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.symbol',
        '{}'::pg_catalog.jsonb,
        true),
        'side',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.side',
        '{}'::pg_catalog.jsonb,
        true),
        'quantity',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.economics.quantity',
        '{}'::pg_catalog.jsonb,
        true)),
        'evidence',
        pg_catalog.jsonb_build_object('schemaVersion',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.schemaVersion',
        '{}'::pg_catalog.jsonb,
        true),
        'source',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.source',
        '{}'::pg_catalog.jsonb,
        true),
        'capitalEligible',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.capitalEligible',
        '{}'::pg_catalog.jsonb,
        true),
        'cycleId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.cycleId',
        '{}'::pg_catalog.jsonb,
        true),
        'sealedMarketCycleContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.sealedMarketCycleContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'orderId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.orderId',
        '{}'::pg_catalog.jsonb,
        true),
        'fillId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.fillId',
        '{}'::pg_catalog.jsonb,
        true),
        'economicsContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.economicsContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingFrontierContentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.accountingFrontierContentDigestHex',
        '{}'::pg_catalog.jsonb,
        true),
        'contentDigestHex',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.evidence.contentDigestHex',
        '{}'::pg_catalog.jsonb,
        true)),
        'accountingId',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.accountingFrontier.id',
        '{}'::pg_catalog.jsonb,
        true),
        'accountingDigest',
        pg_catalog.jsonb_path_query_first(artifacts_json,
        'strict $[1].payload.lineagePayload.fillDetail.accountingFrontier.semanticContentDigest',
        '{}'::pg_catalog.jsonb,
        true)) END))) END)) ELSE NULL::pg_catalog.jsonb END) ELSE NULL::pg_catalog.jsonb END))::pg_catalog.text COLLATE pg_catalog."C") ELSE false END) IS TRUE END) NOT VALID;
--> statement-breakpoint
-- DEE-1130: bounded companion of the existing atomic historical owner.
-- No financial calculation, caller certification API or legacy permission grant.
-- All existing migrations, source constraints and invoker RLS remain unchanged.
CREATE TABLE public.trader_historical_reconciliation_scope_mode_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL,
  run_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('LEGACY','PROFILE')),
  profile text,
  partition text,
  symbol text,
  genesis_id uuid,
  writer_xid text NOT NULL,
  PRIMARY KEY (organization_id,account_id,run_id),
  CHECK ((mode='LEGACY' AND profile IS NULL AND partition IS NULL AND symbol IS NULL AND genesis_id IS NULL)
    OR (mode='PROFILE' AND profile IS NOT DISTINCT FROM 'HISTORICAL_PG_RECONCILIATION_V1'
      AND partition IN ('DEVELOPMENT','WALK_FORWARD') AND partition IS NOT NULL
      AND symbol IN ('BTCUSDT','ETHUSDT') AND symbol IS NOT NULL AND genesis_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE public.trader_historical_reconciliation_frontier_v1 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL,
  run_id text NOT NULL,
  cycle_sequence integer NOT NULL CHECK (cycle_sequence >= -1),
  partition text NOT NULL CHECK (partition IN ('DEVELOPMENT','WALK_FORWARD')),
  profile text NOT NULL CHECK (profile='HISTORICAL_PG_RECONCILIATION_V1'),
  symbol text NOT NULL CHECK (symbol IN ('BTCUSDT','ETHUSDT')),
  previous_id uuid,
  genesis_id uuid,
  checkpoint_digest text,
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK (octet_length(body_text)<=1048576),
  body_json jsonb NOT NULL CHECK (jsonb_typeof(body_json)='object' AND octet_length(body_json::text)<=1048576),
  writer_xid text NOT NULL,
  fill_id uuid GENERATED ALWAYS AS ((body_json->'fillDelta'->>'fillId')::uuid) STORED,
  fill_accounting_id uuid GENERATED ALWAYS AS ((body_json->'fillDelta'->>'fillAccountingId')::uuid) STORED,
  accounting_id uuid GENERATED ALWAYS AS ((body_json->'accounting'->>'id')::uuid) STORED,
  checkpoint_sequence integer GENERATED ALWAYS AS (CASE WHEN cycle_sequence>=0 THEN cycle_sequence END) STORED,
  UNIQUE (organization_id,account_id,run_id,cycle_sequence),
  UNIQUE (id,organization_id,account_id,run_id),
  FOREIGN KEY (organization_id,account_id,run_id) REFERENCES public.trader_historical_reconciliation_scope_mode_v1,
  FOREIGN KEY (previous_id,organization_id,account_id,run_id)
    REFERENCES public.trader_historical_reconciliation_frontier_v1(id,organization_id,account_id,run_id),
  FOREIGN KEY (genesis_id,organization_id,account_id,run_id)
    REFERENCES public.trader_historical_reconciliation_frontier_v1(id,organization_id,account_id,run_id),
  FOREIGN KEY (fill_id,organization_id) REFERENCES public.trader_fills(id,organization_id),
  FOREIGN KEY (fill_accounting_id,organization_id) REFERENCES public.trader_accounting_frontier(id,organization_id),
  FOREIGN KEY (accounting_id,organization_id) REFERENCES public.trader_accounting_frontier(id,organization_id),
  FOREIGN KEY (organization_id,account_id,run_id,checkpoint_sequence)
    REFERENCES public.trader_historical_simulation_resume_checkpoint_v2
      (organization_id,account_id,run_id,committed_cycle_sequence) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((cycle_sequence=-1 AND previous_id IS NULL AND genesis_id IS NULL AND checkpoint_digest IS NULL)
    OR (cycle_sequence>=0 AND previous_id IS NOT NULL AND genesis_id IS NOT NULL AND checkpoint_digest ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE public.trader_historical_reconciliation_scope_mode_v1 ADD CONSTRAINT historical_reconciliation_mode_genesis_fk
  FOREIGN KEY (genesis_id,organization_id,account_id,run_id)
  REFERENCES public.trader_historical_reconciliation_frontier_v1(id,organization_id,account_id,run_id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX historical_reconciliation_one_cycle_per_xid ON public.trader_historical_reconciliation_frontier_v1
  (organization_id,account_id,run_id,writer_xid) WHERE cycle_sequence>=0;
--> statement-breakpoint
CREATE UNIQUE INDEX historical_reconciliation_fill_once ON public.trader_historical_reconciliation_frontier_v1
  (organization_id,account_id,run_id,fill_id) WHERE fill_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX historical_reconciliation_fill_accounting_once ON public.trader_historical_reconciliation_frontier_v1
  (organization_id,account_id,run_id,fill_accounting_id) WHERE fill_accounting_id IS NOT NULL;
--> statement-breakpoint
-- Adds only the bounded active-parent access path, not a duplicate of0201's existence index.
CREATE INDEX historical_reconciliation_active_parent ON public.trader_orders
  (organization_id,historical_account_key,historical_run_id,id)
  WHERE historical_account_key IS NOT NULL AND historical_run_id IS NOT NULL
    AND state NOT IN ('FILLED','CANCELLED','REJECTED','EXPIRED','FAILED');
--> statement-breakpoint
CREATE FUNCTION public.waia_historical_reconciliation_stamp_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE expected_hash text; identity_hash text; b jsonb; bytes bigint; canonical_text text; total_bytes bigint:=65536;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN
    ('trader_historical_reconciliation_scope_mode_v1','trader_historical_reconciliation_frontier_v1')
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN
    RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:TRIGGER_CONTEXT';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:APPEND_ONLY'; END IF;
  IF NEW.writer_xid IS NOT NULL THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:WRITER_STAMP'; END IF;
  IF TG_TABLE_NAME='trader_historical_reconciliation_frontier_v1' THEN
    IF NEW.body_json IS NOT NULL THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CALLER_BODY_JSON';
    END IF;
    bytes:=octet_length(NEW.body_text);
    -- Sixteen bounded-occurrence reservations: input/parse/canonical (3),
    -- derived JSON and capacity text (2), stripped body/canonical/UTF8 (3),
    -- remaining row CHECK text and three generated scalar-prefix accesses (4),
    -- four additional bounded assignment/tuple representations (4). The small
    -- companion contains no cumulative source. These reserves also cover its
    -- associated generated/constraint expressions; no uncharged source reader.
    total_bytes:=total_bytes+16*COALESCE(bytes,0);
    IF bytes IS NULL OR bytes>1048576 OR total_bytes>8388608 THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
    END IF;
    b := NEW.body_text::jsonb;
    canonical_text := public.waia_canonical_jsonb_v1(b);
    IF canonical_text IS DISTINCT FROM NEW.body_text THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CANONICAL_TEXT';
    END IF;
    NEW.body_json:=b;
    IF b IS NULL OR jsonb_typeof(b)<>'object' OR octet_length(b::text)>1048576 THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
    END IF;
    expected_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(b-ARRAY['id','contentDigest']),'UTF8')),'hex');
    identity_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(jsonb_build_object(
      'schemaVersion','execution-deterministic-identity/v2','kind','report','seed',jsonb_build_object(
        'kind','waia.trader.historical_reconciliation.v1','contentDigest',expected_hash))),'UTF8')),'hex');
    identity_hash := substr(identity_hash,1,12)||'5'||substr(identity_hash,14,3)||'8'||substr(identity_hash,18,15);
    IF NEW.id IS DISTINCT FROM identity_hash::uuid OR NEW.content_digest IS DISTINCT FROM expected_hash
      OR b->>'contentDigest' IS DISTINCT FROM expected_hash OR b->>'id' IS DISTINCT FROM NEW.id::text
      OR b->>'schemaVersion' IS DISTINCT FROM 'waia.trader.historical_reconciliation.v1'
      OR b->>'profile' IS DISTINCT FROM NEW.profile OR b->>'symbol' IS DISTINCT FROM NEW.symbol
      OR b->'scope' IS DISTINCT FROM jsonb_build_object('organizationId',NEW.organization_id,'accountId',NEW.account_id,
        'runId',NEW.run_id,'split',NEW.partition)
      OR (b->>'cycleSequence')::integer IS DISTINCT FROM NEW.cycle_sequence
      OR (b->>'previousId')::uuid IS DISTINCT FROM NEW.previous_id OR (b->>'genesisId')::uuid IS DISTINCT FROM NEW.genesis_id
      OR b->>'checkpointDigest' IS DISTINCT FROM NEW.checkpoint_digest
      OR b->'accounting'->>'organizationId' IS DISTINCT FROM NEW.organization_id::text
      OR b->'accounting'->>'accountId' IS DISTINCT FROM NEW.account_id OR b->'accounting'->>'runId' IS DISTINCT FROM NEW.run_id
      OR (b->>'authorityDigest' ~ '^[0-9a-f]{64}$') IS NOT TRUE
      OR (b->>'modelDigest' ~ '^[0-9a-f]{64}$') IS NOT TRUE OR (b->>'releaseSha' ~ '^[0-9a-f]{40}$') IS NOT TRUE
      OR (b->>'initialRecordIndex')::bigint IS NULL OR (b->>'initialRecordIndex')::bigint<0
      OR b->'accounting'->>'id' IS NULL OR (b->'accounting'->>'sequence')::bigint IS NULL
      OR jsonb_typeof(b->'steps') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array'
      OR jsonb_typeof(b->'touchedParentsAfter') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:BODY_COLUMNS';
    END IF;
    IF NEW.cycle_sequence=-1 AND (b->'fillDelta' IS DISTINCT FROM 'null'::jsonb
      OR b->'cycleId' IS DISTINCT FROM 'null'::jsonb OR b->'activeParentAfter' IS DISTINCT FROM 'null'::jsonb
      OR b->'steps'<>'[]'::jsonb OR b->'observations'<>'[]'::jsonb OR b->'touchedParentsAfter'<>'[]'::jsonb
      OR b->'accounting'->'positions' IS DISTINCT FROM '{}'::jsonb
      OR (b->'accounting'->>'sequence')::bigint<>1 OR b->'accounting'->'sourceFillId' IS DISTINCT FROM 'null'::jsonb
      OR b->'accounting'->>'id' IS DISTINCT FROM b->>'inceptionAccountingId'
      OR b->'accounting'->>'digest' IS DISTINCT FROM b->>'inceptionAccountingDigest'
      OR b->'accounting'->>'cash' IS DISTINCT FROM b->>'startingCash'
      OR b->>'expectedCashAfter' IS DISTINCT FROM b->>'startingCash'
      OR (b->>'expectedOpenQuantityAfter')::numeric IS DISTINCT FROM 0::numeric
      OR (b->>'consumedFillCount')::bigint IS DISTINCT FROM 0::bigint
      OR b->'lastConsumedFillId' IS DISTINCT FROM 'null'::jsonb
      OR (b->>'recordIndex')::bigint IS DISTINCT FROM (b->>'initialRecordIndex')::bigint-1) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:GENESIS_SHAPE';
    END IF;
  END IF;
  IF TG_TABLE_NAME='trader_historical_reconciliation_scope_mode_v1' THEN
    bytes:=COALESCE(octet_length(NEW.account_id),0)+COALESCE(octet_length(NEW.run_id),0)+1024;
    IF bytes>1048576 OR 4*bytes+65536>8388608 THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
    END IF;
  END IF;
  NEW.writer_xid := pg_current_xact_id()::text;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_historical_reconciliation_stamp_v1() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER historical_reconciliation_mode_stamp BEFORE INSERT OR UPDATE OR DELETE
  ON public.trader_historical_reconciliation_scope_mode_v1 FOR EACH ROW
  EXECUTE FUNCTION public.waia_historical_reconciliation_stamp_v1();
--> statement-breakpoint
CREATE TRIGGER historical_reconciliation_frontier_stamp BEFORE INSERT OR UPDATE OR DELETE
  ON public.trader_historical_reconciliation_frontier_v1 FOR EACH ROW
  EXECUTE FUNCTION public.waia_historical_reconciliation_stamp_v1();

--> statement-breakpoint
-- Small writer: literal LEGACY only. It deliberately does not use historical approval.
CREATE FUNCTION public.waia_historical_reconciliation_legacy_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $fn$
DECLARE
  row_number integer; old_key boolean; keys jsonb; k jsonb;
  source_order uuid; source_fill uuid; source_ledger text;
  scope_org uuid; scope_account text; scope_run text; selected_mode text; inserted_mode text;
  bytes bigint; total_bytes bigint:=65536;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN (
    'trader_orders',
    'trader_order_events',
    'trader_fills',
    'trader_fill_execution_economics',
    'trader_accounting_frontier',
    'trader_historical_simulation_reason_ledger_v2',
    'trader_historical_simulation_modeled_evidence_v2',
    'trader_historical_simulation_atomic_stage_v2',
    'trader_historical_simulation_durable_snapshot_v2',
    'trader_historical_simulation_resume_checkpoint_v2',
    'trader_historical_simulation_resume_stage_link_v2',
    'trader_historical_simulation_resume_snapshot_link_v2') OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE','DELETE')
    OR (TG_TABLE_NAME IN ('trader_historical_simulation_atomic_stage_v2','trader_historical_simulation_durable_snapshot_v2',
      'trader_historical_simulation_resume_checkpoint_v2') AND (TG_WHEN<>'AFTER' OR TG_OP<>'INSERT'))
    OR (TG_TABLE_NAME NOT IN ('trader_historical_simulation_atomic_stage_v2','trader_historical_simulation_durable_snapshot_v2',
      'trader_historical_simulation_resume_checkpoint_v2') AND TG_WHEN<>'BEFORE') THEN
    RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:TRIGGER_CONTEXT';
  END IF;
  IF TG_OP<>'INSERT' AND TG_TABLE_NAME NOT IN ('trader_orders','trader_order_events','trader_fills') THEN
    RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:TRIGGER_CONTEXT';
  END IF;
  keys := '[]'::jsonb;
  FOR row_number IN 1..CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END LOOP
    old_key:=TG_OP='DELETE' OR (TG_OP='UPDATE' AND row_number=1);
    scope_org := CASE WHEN old_key THEN OLD.organization_id ELSE NEW.organization_id END; scope_account := NULL; scope_run := NULL;
    CASE TG_TABLE_NAME
      WHEN 'trader_orders' THEN
        scope_account:=CASE WHEN old_key THEN OLD.historical_account_key ELSE NEW.historical_account_key END;
        scope_run:=CASE WHEN old_key THEN OLD.historical_run_id ELSE NEW.historical_run_id END;
      WHEN 'trader_order_events', 'trader_fills', 'trader_fill_execution_economics' THEN
        source_order:=CASE WHEN old_key THEN OLD.order_id ELSE NEW.order_id END;
        IF TG_TABLE_NAME='trader_fill_execution_economics' THEN
          source_fill:=CASE WHEN old_key THEN OLD.fill_id ELSE NEW.fill_id END;
        END IF;
        SELECT o.historical_account_key,o.historical_run_id INTO scope_account,scope_run
          FROM public.trader_orders o WHERE o.organization_id=scope_org AND o.id=source_order;
        IF NOT FOUND THEN
          -- PROFILE parent DELETE is stopped by the parent's BEFORE verifier.
          -- Preserve the original legitimate LEGACY cascade after parent deletion.
          IF TG_OP='DELETE' THEN CONTINUE; END IF;
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_MISSING';
        END IF;
        IF TG_TABLE_NAME='trader_fill_execution_economics' AND NOT EXISTS(
          SELECT 1 FROM public.trader_fills f WHERE f.organization_id=scope_org
            AND f.id=source_fill AND f.order_id=source_order) THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_PARENT_MISMATCH';
        END IF;
      WHEN 'trader_accounting_frontier' THEN
        scope_account:=CASE WHEN old_key THEN OLD.account_key ELSE NEW.account_key END;
        scope_run:=CASE WHEN old_key THEN OLD.run_id ELSE NEW.run_id END;
      WHEN 'trader_historical_simulation_modeled_evidence_v2' THEN
        bytes:=octet_length(CASE WHEN old_key THEN OLD.reason_ledger_entry_id ELSE NEW.reason_ledger_entry_id END);
        total_bytes:=total_bytes+2*COALESCE(bytes,0);
        IF bytes IS NULL OR bytes>1048576 OR total_bytes>8388608 THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
        END IF;
        source_ledger:=CASE WHEN old_key THEN OLD.reason_ledger_entry_id ELSE NEW.reason_ledger_entry_id END;
        SELECT l.account_id,l.run_id INTO scope_account,scope_run
          FROM public.trader_historical_simulation_reason_ledger_v2 l
          WHERE l.organization_id=scope_org AND l.entry_id=source_ledger;
        IF NOT FOUND THEN
          IF TG_WHEN='BEFORE' THEN CONTINUE; END IF;
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:LEDGER_PARENT_MISSING';
        END IF;
      ELSE
        scope_account:=CASE WHEN old_key THEN OLD.account_id ELSE NEW.account_id END;
        scope_run:=CASE WHEN old_key THEN OLD.run_id ELSE NEW.run_id END;
    END CASE;
    IF (scope_account IS NULL) <> (scope_run IS NULL) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARTIAL_SCOPE';
    END IF;
    IF scope_account IS NOT NULL THEN
      -- Reserve JSON escaping as well as the fixed key names; no raw-text/JSON-size equivalence.
      bytes:=6::bigint*(octet_length(scope_account)+octet_length(scope_run))+1024;
      total_bytes:=total_bytes+8*bytes;
      IF bytes>1048576 OR total_bytes>8388608 THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
      END IF;
      keys := keys || jsonb_build_array(jsonb_build_object('org',scope_org,'account',scope_account,'run',scope_run));
    END IF;
  END LOOP;
  -- The exact initial frontier is mode-neutral, never a profile certificate.
  IF TG_TABLE_NAME='trader_accounting_frontier' AND TG_OP='INSERT' THEN
    IF NEW.accounting_sequence=1 AND NEW.source_fill_id IS NULL THEN RETURN NEW; END IF;
  END IF;
  FOR k IN SELECT value FROM (SELECT DISTINCT value FROM jsonb_array_elements(keys)) distinct_keys
    ORDER BY value->>'org' COLLATE "C",value->>'account' COLLATE "C",value->>'run' COLLATE "C" LOOP
    scope_org := (k->>'org')::uuid; scope_account := k->>'account'; scope_run := k->>'run';
    inserted_mode := NULL;
    INSERT INTO public.trader_historical_reconciliation_scope_mode_v1(organization_id,account_id,run_id,mode)
      VALUES(scope_org,scope_account,scope_run,'LEGACY')
      ON CONFLICT (organization_id,account_id,run_id) DO NOTHING RETURNING mode INTO inserted_mode;
    IF inserted_mode IS NULL THEN
      SELECT mode INTO selected_mode FROM public.trader_historical_reconciliation_scope_mode_v1
        WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run;
      IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:MODE_WINNER_NOT_VISIBLE'; END IF;
    END IF;
  END LOOP;
  IF TG_WHEN='AFTER' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_historical_reconciliation_legacy_v1() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT OR UPDATE OR DELETE ON public.trader_orders
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT OR UPDATE OR DELETE ON public.trader_order_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT OR UPDATE OR DELETE ON public.trader_fills
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_fill_execution_economics
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_accounting_frontier
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_historical_simulation_reason_ledger_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_historical_simulation_modeled_evidence_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode AFTER INSERT ON public.trader_historical_simulation_atomic_stage_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode AFTER INSERT ON public.trader_historical_simulation_durable_snapshot_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode AFTER INSERT ON public.trader_historical_simulation_resume_checkpoint_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_historical_simulation_resume_stage_link_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();
--> statement-breakpoint
CREATE TRIGGER aa_historical_reconciliation_mode BEFORE INSERT ON public.trader_historical_simulation_resume_snapshot_link_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_legacy_v1();

--> statement-breakpoint
-- Read-only trigger verifier. No DML, arbitrary inputs, public certifier or role inference.
-- Original source RLS still executes in the original statement's active-role context.
CREATE FUNCTION public.waia_historical_reconciliation_verify_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $fn$
DECLARE
  row_number integer; old_key boolean; keys jsonb; k jsonb;
  source_order uuid; source_fill uuid; source_ledger text;
  scope_org uuid; scope_account text; scope_run text;
  mode_row public.trader_historical_reconciliation_scope_mode_v1%ROWTYPE;
  current_row public.trader_historical_reconciliation_frontier_v1%ROWTYPE;
  previous_row public.trader_historical_reconciliation_frontier_v1%ROWTYPE;
  genesis_row public.trader_historical_reconciliation_frontier_v1%ROWTYPE;
  checkpoint_row record; source_projection jsonb; body jsonb; prior jsonb; genesis jsonb;
  parent jsonb; ref jsonb; step jsonb; selected jsonb; projected jsonb; detail jsonb; exchange_projection jsonb;
  actual_order record; current_fill jsonb; current_economics jsonb;
  accounting_source jsonb; exchange_source jsonb; effects_source jsonb; ledger_id text;
  actual_count integer; member_count integer; bytes bigint; total_bytes bigint:=65536;
  source_sequence integer; delta jsonb; expected_cash numeric; expected_quantity numeric;
  expected_hash text; actual_ids uuid[]; expected_ids uuid[]; active_ids uuid[];
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN (
    'trader_orders',
    'trader_order_events',
    'trader_fills',
    'trader_fill_execution_economics',
    'trader_accounting_frontier',
    'trader_historical_simulation_reason_ledger_v2',
    'trader_historical_simulation_modeled_evidence_v2',
    'trader_historical_simulation_atomic_stage_v2',
    'trader_historical_simulation_durable_snapshot_v2',
    'trader_historical_simulation_resume_checkpoint_v2',
    'trader_historical_simulation_resume_stage_link_v2',
    'trader_historical_simulation_resume_snapshot_link_v2',
    'trader_historical_reconciliation_scope_mode_v1',
    'trader_historical_reconciliation_frontier_v1') OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE','DELETE')
    OR TG_WHEN NOT IN ('BEFORE','AFTER') THEN
    RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:TRIGGER_CONTEXT';
  END IF;
  IF (TG_WHEN='BEFORE' AND NOT (
      (TG_TABLE_NAME='trader_historical_reconciliation_scope_mode_v1' AND TG_OP='INSERT') OR
      (TG_TABLE_NAME IN ('trader_orders','trader_order_events','trader_fills') AND TG_OP IN ('UPDATE','DELETE'))))
    OR (TG_WHEN='AFTER' AND NOT (TG_OP='INSERT' OR (TG_TABLE_NAME='trader_orders' AND TG_OP='UPDATE'))) THEN
    RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:TRIGGER_CONTEXT';
  END IF;
  IF TG_TABLE_NAME='trader_historical_reconciliation_scope_mode_v1' AND TG_WHEN='BEFORE' THEN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:APPEND_ONLY'; END IF;
    bytes:=COALESCE(octet_length(NEW.account_id),0)+COALESCE(octet_length(NEW.run_id),0)+1024;
    IF bytes>1048576 OR 4*bytes+65536>8388608 THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
    END IF;
    IF NEW.mode='PROFILE' THEN
      IF EXISTS(SELECT 1 FROM public.trader_orders WHERE organization_id=NEW.organization_id
          AND historical_account_key=NEW.account_id AND historical_run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_accounting_frontier WHERE organization_id=NEW.organization_id
          AND account_key=NEW.account_id AND run_id=NEW.run_id AND accounting_sequence>1 LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_reason_ledger_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_atomic_stage_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_durable_snapshot_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_resume_checkpoint_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_resume_stage_link_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_simulation_resume_snapshot_link_v2 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
        OR EXISTS(SELECT 1 FROM public.trader_historical_reconciliation_frontier_v1 WHERE organization_id=NEW.organization_id
          AND account_id=NEW.account_id AND run_id=NEW.run_id LIMIT 1)
      THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:LEGACY_PREFIX_UNSUPPORTED'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  keys := '[]'::jsonb;
  FOR row_number IN 1..CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END LOOP
    old_key:=TG_OP='DELETE' OR (TG_OP='UPDATE' AND row_number=1);
    scope_org := CASE WHEN old_key THEN OLD.organization_id ELSE NEW.organization_id END; scope_account := NULL; scope_run := NULL;
    CASE TG_TABLE_NAME
      WHEN 'trader_orders' THEN
        scope_account:=CASE WHEN old_key THEN OLD.historical_account_key ELSE NEW.historical_account_key END;
        scope_run:=CASE WHEN old_key THEN OLD.historical_run_id ELSE NEW.historical_run_id END;
      WHEN 'trader_order_events', 'trader_fills', 'trader_fill_execution_economics' THEN
        source_order:=CASE WHEN old_key THEN OLD.order_id ELSE NEW.order_id END;
        IF TG_TABLE_NAME='trader_fill_execution_economics' THEN
          source_fill:=CASE WHEN old_key THEN OLD.fill_id ELSE NEW.fill_id END;
        END IF;
        SELECT o.historical_account_key,o.historical_run_id INTO scope_account,scope_run
          FROM public.trader_orders o WHERE o.organization_id=scope_org AND o.id=source_order;
        IF NOT FOUND THEN
          -- PROFILE parent DELETE is stopped by the parent's BEFORE verifier.
          -- Preserve the original legitimate LEGACY cascade after parent deletion.
          IF TG_OP='DELETE' THEN CONTINUE; END IF;
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_MISSING';
        END IF;
        IF TG_TABLE_NAME='trader_fill_execution_economics' AND NOT EXISTS(
          SELECT 1 FROM public.trader_fills f WHERE f.organization_id=scope_org
            AND f.id=source_fill AND f.order_id=source_order) THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_PARENT_MISMATCH';
        END IF;
      WHEN 'trader_accounting_frontier' THEN
        scope_account:=CASE WHEN old_key THEN OLD.account_key ELSE NEW.account_key END;
        scope_run:=CASE WHEN old_key THEN OLD.run_id ELSE NEW.run_id END;
      WHEN 'trader_historical_simulation_modeled_evidence_v2' THEN
        bytes:=octet_length(CASE WHEN old_key THEN OLD.reason_ledger_entry_id ELSE NEW.reason_ledger_entry_id END);
        total_bytes:=total_bytes+2*COALESCE(bytes,0);
        IF bytes IS NULL OR bytes>1048576 OR total_bytes>8388608 THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
        END IF;
        source_ledger:=CASE WHEN old_key THEN OLD.reason_ledger_entry_id ELSE NEW.reason_ledger_entry_id END;
        SELECT l.account_id,l.run_id INTO scope_account,scope_run
          FROM public.trader_historical_simulation_reason_ledger_v2 l
          WHERE l.organization_id=scope_org AND l.entry_id=source_ledger;
        IF NOT FOUND THEN
          IF TG_WHEN='BEFORE' THEN CONTINUE; END IF;
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:LEDGER_PARENT_MISSING';
        END IF;
      ELSE
        scope_account:=CASE WHEN old_key THEN OLD.account_id ELSE NEW.account_id END;
        scope_run:=CASE WHEN old_key THEN OLD.run_id ELSE NEW.run_id END;
    END CASE;
    IF (scope_account IS NULL) <> (scope_run IS NULL) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARTIAL_SCOPE';
    END IF;
    IF scope_account IS NOT NULL THEN
      -- Reserve JSON escaping as well as the fixed key names; no raw-text/JSON-size equivalence.
      bytes:=6::bigint*(octet_length(scope_account)+octet_length(scope_run))+1024;
      total_bytes:=total_bytes+8*bytes;
      IF bytes>1048576 OR total_bytes>8388608 THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE';
      END IF;
      keys := keys || jsonb_build_array(jsonb_build_object('org',scope_org,'account',scope_account,'run',scope_run));
    END IF;
  END LOOP;
  FOR k IN SELECT value FROM (SELECT DISTINCT value FROM jsonb_array_elements(keys)) distinct_keys
    ORDER BY value->>'org' COLLATE "C",value->>'account' COLLATE "C",value->>'run' COLLATE "C" LOOP
    scope_org := (k->>'org')::uuid; scope_account := k->>'account'; scope_run := k->>'run';
    SELECT * INTO mode_row FROM public.trader_historical_reconciliation_scope_mode_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run;
    IF NOT FOUND THEN
      IF TG_TABLE_NAME='trader_accounting_frontier' AND TG_OP='INSERT' THEN
        IF NEW.accounting_sequence=1 AND NEW.source_fill_id IS NULL THEN CONTINUE; END IF;
      END IF;
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:MODE_WINNER_NOT_VISIBLE';
    END IF;
    IF mode_row.mode='LEGACY' THEN
      IF TG_TABLE_NAME='trader_historical_reconciliation_frontier_v1' THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:LEGACY_FRONTIER';
      END IF;
      CONTINUE;
    END IF;
    IF TG_WHEN='BEFORE' THEN
      IF TG_TABLE_NAME IN ('trader_order_events','trader_fills') AND TG_OP IN ('UPDATE','DELETE') THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_IMMUTABLE';
      END IF;
      IF TG_TABLE_NAME='trader_orders' THEN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PROFILE_PARENT_DELETE'; END IF;
        bytes:=6::bigint*(COALESCE(octet_length(OLD.id::text),0)+COALESCE(octet_length(OLD.organization_id::text),0)+COALESCE(octet_length(OLD.credential_id::text),0)+COALESCE(octet_length(OLD.venue::text),0)+COALESCE(octet_length(OLD.execution_mode::text),0)+COALESCE(octet_length(OLD.historical_run_id::text),0)+COALESCE(octet_length(OLD.historical_account_key::text),0)+COALESCE(octet_length(OLD.symbol::text),0)+COALESCE(octet_length(OLD.side::text),0)+COALESCE(octet_length(OLD.type::text),0)+COALESCE(octet_length(OLD.price::text),0)+COALESCE(octet_length(OLD.quantity::text),0)+COALESCE(octet_length(OLD.client_order_id::text),0)+COALESCE(octet_length(OLD.idempotency_key::text),0)+COALESCE(octet_length(OLD.risk_decision_id::text),0)+COALESCE(octet_length(OLD.risk_allowance_id::text),0)+COALESCE(octet_length(OLD.risk_allowance_binding_digest::text),0)+COALESCE(octet_length(OLD.opening_causal_lineage_json::text),0)+COALESCE(octet_length(OLD.opening_causal_lineage_digest::text),0)+COALESCE(octet_length(OLD.execution_plan_id::text),0)+COALESCE(octet_length(OLD.execution_plan_digest::text),0)+COALESCE(octet_length(OLD.execution_attempt_id::text),0)+COALESCE(octet_length(OLD.execution_attempt_digest::text),0)+COALESCE(octet_length(OLD.strategy_signal_id::text),0)+COALESCE(octet_length(OLD.allocation_decision_id::text),0)+COALESCE(octet_length(OLD.created_at::text),0)+2048+COALESCE(octet_length(NEW.id::text),0)+COALESCE(octet_length(NEW.organization_id::text),0)+COALESCE(octet_length(NEW.credential_id::text),0)+COALESCE(octet_length(NEW.venue::text),0)+COALESCE(octet_length(NEW.execution_mode::text),0)+COALESCE(octet_length(NEW.historical_run_id::text),0)+COALESCE(octet_length(NEW.historical_account_key::text),0)+COALESCE(octet_length(NEW.symbol::text),0)+COALESCE(octet_length(NEW.side::text),0)+COALESCE(octet_length(NEW.type::text),0)+COALESCE(octet_length(NEW.price::text),0)+COALESCE(octet_length(NEW.quantity::text),0)+COALESCE(octet_length(NEW.client_order_id::text),0)+COALESCE(octet_length(NEW.idempotency_key::text),0)+COALESCE(octet_length(NEW.risk_decision_id::text),0)+COALESCE(octet_length(NEW.risk_allowance_id::text),0)+COALESCE(octet_length(NEW.risk_allowance_binding_digest::text),0)+COALESCE(octet_length(NEW.opening_causal_lineage_json::text),0)+COALESCE(octet_length(NEW.opening_causal_lineage_digest::text),0)+COALESCE(octet_length(NEW.execution_plan_id::text),0)+COALESCE(octet_length(NEW.execution_plan_digest::text),0)+COALESCE(octet_length(NEW.execution_attempt_id::text),0)+COALESCE(octet_length(NEW.execution_attempt_digest::text),0)+COALESCE(octet_length(NEW.strategy_signal_id::text),0)+COALESCE(octet_length(NEW.allocation_decision_id::text),0)+COALESCE(octet_length(NEW.created_at::text),0)+2048);
        total_bytes:=total_bytes+2*bytes;
        IF bytes>1048576 OR total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
        IF TG_OP='UPDATE' AND jsonb_build_object('id',OLD.id,'organization_id',OLD.organization_id,'credential_id',OLD.credential_id,'venue',OLD.venue,'execution_mode',OLD.execution_mode,'historical_run_id',OLD.historical_run_id,'historical_account_key',OLD.historical_account_key,'symbol',OLD.symbol,'side',OLD.side,'type',OLD.type,'price',OLD.price,'quantity',OLD.quantity,'client_order_id',OLD.client_order_id,'idempotency_key',OLD.idempotency_key,'risk_decision_id',OLD.risk_decision_id,'risk_allowance_id',OLD.risk_allowance_id,'risk_allowance_binding_digest',OLD.risk_allowance_binding_digest,'opening_causal_lineage_json',OLD.opening_causal_lineage_json,'opening_causal_lineage_digest',OLD.opening_causal_lineage_digest,'execution_plan_id',OLD.execution_plan_id,'execution_plan_digest',OLD.execution_plan_digest,'execution_attempt_id',OLD.execution_attempt_id,'execution_attempt_digest',OLD.execution_attempt_digest,'strategy_signal_id',OLD.strategy_signal_id,'allocation_decision_id',OLD.allocation_decision_id,'created_at',OLD.created_at) IS DISTINCT FROM jsonb_build_object('id',NEW.id,'organization_id',NEW.organization_id,'credential_id',NEW.credential_id,'venue',NEW.venue,'execution_mode',NEW.execution_mode,'historical_run_id',NEW.historical_run_id,'historical_account_key',NEW.historical_account_key,'symbol',NEW.symbol,'side',NEW.side,'type',NEW.type,'price',NEW.price,'quantity',NEW.quantity,'client_order_id',NEW.client_order_id,'idempotency_key',NEW.idempotency_key,'risk_decision_id',NEW.risk_decision_id,'risk_allowance_id',NEW.risk_allowance_id,'risk_allowance_binding_digest',NEW.risk_allowance_binding_digest,'opening_causal_lineage_json',NEW.opening_causal_lineage_json,'opening_causal_lineage_digest',NEW.opening_causal_lineage_digest,'execution_plan_id',NEW.execution_plan_id,'execution_plan_digest',NEW.execution_plan_digest,'execution_attempt_id',NEW.execution_attempt_id,'execution_attempt_digest',NEW.execution_attempt_digest,'strategy_signal_id',NEW.strategy_signal_id,'allocation_decision_id',NEW.allocation_decision_id,'created_at',NEW.created_at) THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_CREATION_CHANGED';
        END IF;
      END IF;
      CONTINUE;
    END IF;
    -- Reserve each deliberate bounded representation, including repeated body-derived
    -- projections/hashes. The source certificate gives the 64-occurrence ceiling.
    SELECT greatest(octet_length(body_text),octet_length(body_json::text)) INTO bytes
      FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND writer_xid=pg_current_xact_id()::text AND cycle_sequence>=0;
    IF bytes IS NULL THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CURRENT_TRANSACTION_CLOSURE'; END IF;
    IF bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    total_bytes:=total_bytes+64*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT * INTO current_row FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run
        AND writer_xid=pg_current_xact_id()::text AND cycle_sequence>=0;
    IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CURRENT_TRANSACTION_CLOSURE'; END IF;
    body := current_row.body_json; current_fill:=NULL; current_economics:=NULL;
    -- Reserve each deliberate bounded representation, including repeated body-derived
    -- projections/hashes. The source certificate gives the 24-occurrence ceiling.
    SELECT greatest(octet_length(body_text),octet_length(body_json::text)) INTO bytes
      FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence-1;
    IF bytes IS NULL THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PREDECESSOR'; END IF;
    IF bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    total_bytes:=total_bytes+24*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT * INTO previous_row FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run
        AND cycle_sequence=current_row.cycle_sequence-1;
    IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PREDECESSOR'; END IF;
    -- Reserve each deliberate bounded representation, including repeated body-derived
    -- projections/hashes. The source certificate gives the 24-occurrence ceiling.
    SELECT greatest(octet_length(body_text),octet_length(body_json::text)) INTO bytes
      FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=-1;
    IF bytes IS NULL THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:GENESIS_MISSING'; END IF;
    IF bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    total_bytes:=total_bytes+24*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT * INTO genesis_row FROM public.trader_historical_reconciliation_frontier_v1
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=-1;
    IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:GENESIS_MISSING'; END IF;
    prior := previous_row.body_json; genesis := genesis_row.body_json;
    IF public.waia_canonical_jsonb_v1(body) IS DISTINCT FROM current_row.body_text
      OR public.waia_canonical_jsonb_v1(prior) IS DISTINCT FROM previous_row.body_text
      OR public.waia_canonical_jsonb_v1(genesis) IS DISTINCT FROM genesis_row.body_text THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CANONICAL_TEXT';
    END IF;
    IF mode_row.genesis_id IS DISTINCT FROM genesis_row.id OR current_row.genesis_id IS DISTINCT FROM genesis_row.id
      OR current_row.previous_id IS DISTINCT FROM previous_row.id OR body->>'previousDigest' IS DISTINCT FROM previous_row.content_digest
      OR mode_row.partition IS DISTINCT FROM current_row.partition OR genesis_row.partition IS DISTINCT FROM current_row.partition
      OR mode_row.symbol IS DISTINCT FROM current_row.symbol OR genesis_row.symbol IS DISTINCT FROM current_row.symbol
      OR body->>'modelDigest' IS DISTINCT FROM genesis->>'modelDigest'
      OR body->>'authorityDigest' IS DISTINCT FROM genesis->>'authorityDigest'
      OR body->>'inceptionAuthorityId' IS DISTINCT FROM genesis->>'inceptionAuthorityId'
      OR body->>'inceptionAccountingId' IS DISTINCT FROM genesis->>'inceptionAccountingId'
      OR body->>'inceptionAccountingDigest' IS DISTINCT FROM genesis->>'inceptionAccountingDigest'
      OR body->>'startingCash' IS DISTINCT FROM genesis->>'startingCash'
      OR (body->>'recordIndex')::bigint IS DISTINCT FROM (prior->>'recordIndex')::bigint+1
      OR (body->>'previousAccountingSequence')::bigint IS DISTINCT FROM (prior#>>'{accounting,sequence}')::bigint THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FRONTIER_CHAIN';
    END IF;
    IF current_row.cycle_sequence=0 AND (genesis_row.writer_xid<>pg_current_xact_id()::text
      OR mode_row.writer_xid<>pg_current_xact_id()::text) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:GENESIS_TRANSACTION';
    END IF;
    -- Revalidate immutable column/body/digest relations for the three selected rows.
    FOR selected IN SELECT value FROM jsonb_array_elements(jsonb_build_array(body,prior,genesis)) LOOP
      IF (selected->>'schemaVersion' IS DISTINCT FROM 'waia.trader.historical_reconciliation.v1')
        OR selected->>'profile' IS DISTINCT FROM 'HISTORICAL_PG_RECONCILIATION_V1'
        OR selected->'scope' IS DISTINCT FROM jsonb_build_object('organizationId',scope_org,'accountId',scope_account,'runId',scope_run,'split',mode_row.partition)
        OR selected->>'symbol' IS DISTINCT FROM mode_row.symbol THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:BODY_SCOPE';
      END IF;
      expected_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(selected-ARRAY['id','contentDigest']),'UTF8')),'hex');
      IF selected->>'contentDigest' IS DISTINCT FROM expected_hash THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:BODY_DIGEST';
      END IF;
    END LOOP;
    -- Only bounded scalar/selected projection reads of the existing large checkpoint/snapshots.
    SELECT octet_length((jsonb_build_object('digest',c.checkpoint_content_digest_hex,'cycleId',c.committed_cycle_id,'split',c.split,'ledgerId',c.ledger_entry_id,'ledgerDigest',c.ledger_head_content_digest_hex,'next',c.next_record_index,'release',c.commit_request_json->>'codeSha','membership',c.commit_request_json->>'datasetMembershipContentDigestHex','market',c.commit_request_json->'datasetMembership'->>'sealedCycleContentDigestHex'))::text) INTO bytes FROM public.trader_historical_simulation_resume_checkpoint_v2 c
      WHERE c.organization_id=scope_org AND c.account_id=scope_account AND c.run_id=scope_run
        AND c.committed_cycle_sequence=current_row.cycle_sequence;
    IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
    total_bytes:=total_bytes+4*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT c.checkpoint_content_digest_hex AS digest,c.committed_cycle_id AS cycle_id,c.split,
      c.ledger_entry_id,c.ledger_head_content_digest_hex AS ledger_digest,c.next_record_index,
      c.commit_request_json->>'codeSha' AS release_sha,
      c.commit_request_json->>'datasetMembershipContentDigestHex' AS membership_digest,
      c.commit_request_json->'datasetMembership'->>'sealedCycleContentDigestHex' AS market_digest
      INTO checkpoint_row FROM public.trader_historical_simulation_resume_checkpoint_v2 c
      WHERE c.organization_id=scope_org AND c.account_id=scope_account AND c.run_id=scope_run
        AND c.committed_cycle_sequence=current_row.cycle_sequence;
    IF NOT FOUND OR checkpoint_row.digest IS DISTINCT FROM current_row.checkpoint_digest
      OR checkpoint_row.digest IS DISTINCT FROM body->>'checkpointDigest'
      OR checkpoint_row.cycle_id IS DISTINCT FROM body->>'cycleId' OR checkpoint_row.split IS DISTINCT FROM current_row.partition
      OR checkpoint_row.next_record_index IS DISTINCT FROM (body->>'recordIndex')::integer+1
      OR checkpoint_row.release_sha IS DISTINCT FROM body->>'releaseSha'
      OR checkpoint_row.membership_digest IS DISTINCT FROM body->>'membershipDigest'
      OR checkpoint_row.market_digest IS DISTINCT FROM body->>'marketDigest' THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CHECKPOINT_IDENTITY';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.trader_historical_simulation_reason_ledger_v2 l
      WHERE l.organization_id=scope_org AND l.account_id=scope_account AND l.run_id=scope_run
        AND l.cycle_sequence=current_row.cycle_sequence AND l.entry_id=checkpoint_row.ledger_entry_id
        AND l.content_digest_hex=checkpoint_row.ledger_digest AND l.partition=current_row.partition
        AND l.accounting_json->>'frontierContentDigestHex'=body#>>'{accounting,digest}') THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:LEDGER_IDENTITY';
    END IF;
    -- Exact finite0188 stage/snapshot/link sets, never a prefix scan.
    SELECT count(*) INTO actual_count FROM public.trader_historical_simulation_atomic_stage_v2
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence;
    IF actual_count<>10 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:STAGE_SET'; END IF;
    SELECT count(*) INTO actual_count FROM public.trader_historical_simulation_durable_snapshot_v2
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence;
    IF actual_count<>6 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SNAPSHOT_SET'; END IF;
    SELECT count(*) INTO actual_count FROM public.trader_historical_simulation_resume_stage_link_v2
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND committed_cycle_sequence=current_row.cycle_sequence;
    IF actual_count<>10 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:STAGE_LINK_SET'; END IF;
    SELECT count(*) INTO actual_count FROM public.trader_historical_simulation_resume_snapshot_link_v2
      WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND committed_cycle_sequence=current_row.cycle_sequence;
    IF actual_count<>6 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SNAPSHOT_LINK_SET'; END IF;
    SELECT octet_length(reconciliation_projection_v1::text) INTO bytes FROM public.trader_historical_simulation_atomic_stage_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND stage='ACCOUNTING';
    IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_PROJECTION_REQUIRED'; END IF;
    -- metadata text + selected column + nested bounded projections/comparisons.
    total_bytes:=total_bytes+8*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT reconciliation_projection_v1->'value' INTO accounting_source FROM public.trader_historical_simulation_atomic_stage_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND stage='ACCOUNTING';
    SELECT octet_length(reconciliation_projection_v1::text) INTO bytes FROM public.trader_historical_simulation_durable_snapshot_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND state_kind='ACCOUNTING_FRONTIER';
    IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_PROJECTION_REQUIRED'; END IF;
    -- metadata text + selected column + nested bounded projections/comparisons.
    total_bytes:=total_bytes+8*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT reconciliation_projection_v1->'value' INTO projected FROM public.trader_historical_simulation_durable_snapshot_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND state_kind='ACCOUNTING_FRONTIER';
    SELECT octet_length(reconciliation_projection_v1::text) INTO bytes FROM public.trader_historical_simulation_durable_snapshot_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND state_kind='MODELED_EXCHANGE';
    IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_PROJECTION_REQUIRED'; END IF;
    -- metadata text + selected column + nested bounded projections/comparisons.
    total_bytes:=total_bytes+8*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT reconciliation_projection_v1->'value' INTO exchange_source FROM public.trader_historical_simulation_durable_snapshot_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND state_kind='MODELED_EXCHANGE';
    SELECT octet_length(reconciliation_projection_v1::text) INTO bytes FROM public.trader_historical_simulation_atomic_stage_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND stage='OBSERVED_EXECUTION_EFFECTS';
    IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_PROJECTION_REQUIRED'; END IF;
    -- metadata text + selected column + nested bounded projections/comparisons.
    total_bytes:=total_bytes+16*bytes;
    IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
    SELECT reconciliation_projection_v1->'value' INTO effects_source FROM public.trader_historical_simulation_atomic_stage_v2 WHERE organization_id=scope_org AND account_id=scope_account AND run_id=scope_run AND cycle_sequence=current_row.cycle_sequence AND stage='OBSERVED_EXECUTION_EFFECTS';
    IF accounting_source IS DISTINCT FROM jsonb_build_object('artifactCount',1,'artifact',jsonb_build_object(
      'artifactKind','ACCOUNTING_FRONTIER','artifactId',body#>>'{accounting,id}','contentDigestHex',body#>>'{accounting,digest}')) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ACCOUNTING_STAGE';
    END IF;
    IF projected->'accounting' IS DISTINCT FROM body->'accounting' THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ACCOUNTING_SNAPSHOT';
    END IF;
    IF exchange_source->'orders' IS DISTINCT FROM to_jsonb(CASE WHEN body->'activeParentAfter'='null'::jsonb THEN 0 ELSE 1 END)
      OR exchange_source->'entries' IS DISTINCT FROM exchange_source->'orders' THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:EXCHANGE_SNAPSHOT_CARDINALITY';
    END IF;
    IF exchange_source->'orders'='1'::jsonb THEN
      parent:=body->'activeParentAfter';
      IF exchange_source->'parent' IS DISTINCT FROM jsonb_build_object('orderId',parent->'orderId',
        'state',parent->'state','stateVersion',parent->'stateVersion','filledQuantity',parent->'filledQuantity',
        'entryOrderId',parent->'orderId','acceptedAt',parent->'acceptedAt','firstEligibleAt',parent->'firstEligibleAt',
        'eligibleBarsSeen',parent->'eligibleBarsSeen','remainingQuantity',parent->'remainingQuantity',
        'entryFilledQuantity',parent->'filledQuantity','fillSequence',parent->'fillSequence','pendingCancel',parent->'pendingCancel') THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:EXCHANGE_SNAPSHOT_CONTENT';
      END IF;
    ELSIF exchange_source->'parent' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:EXCHANGE_SNAPSHOT_CONTENT';
    END IF;
    -- Restore the selected checkpoint scalars for the final source-row closure below.
    SELECT c.ledger_entry_id INTO checkpoint_row FROM public.trader_historical_simulation_resume_checkpoint_v2 c
      WHERE c.organization_id=scope_org AND c.account_id=scope_account AND c.run_id=scope_run
        AND c.committed_cycle_sequence=current_row.cycle_sequence;
    delta := body->'fillDelta';
    IF jsonb_typeof(body->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'steps') NOT IN (1,2)
      OR jsonb_typeof(body->'touchedParentsAfter') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'touchedParentsAfter')>2
      OR jsonb_typeof(body->'observations') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'observations')<>3
      OR body->'steps'->-1 IS DISTINCT FROM body->'accounting'
      OR body#>'{accounting,sourceFillId}' IS DISTINCT FROM 'null'::jsonb
      OR (SELECT count(DISTINCT value->>'orderId') FROM jsonb_array_elements(body->'touchedParentsAfter'))
        IS DISTINCT FROM jsonb_array_length(body->'touchedParentsAfter')::bigint
      OR (body->'activeParentAfter'<>'null'::jsonb AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(body->'touchedParentsAfter') p WHERE p=body->'activeParentAfter'))
      OR jsonb_array_length(body->'steps') IS DISTINCT FROM CASE WHEN delta='null'::jsonb THEN 1 ELSE 2 END THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:CYCLE_SHAPE';
    END IF;
    FOR selected,source_sequence IN SELECT value,ordinality::integer FROM jsonb_array_elements(body->'observations') WITH ORDINALITY LOOP
      IF selected->>'phase' IS DISTINCT FROM (ARRAY['frontier_mutation','before_guardian','before_cycle_complete'])[source_sequence]
        OR selected->>'accountingDigest' IS DISTINCT FROM body#>>'{accounting,digest}'
        OR (selected->>'projectionDigest' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PHASES';
      END IF;
    END LOOP;
    expected_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(jsonb_build_object(
      'accounting',body->'accounting','activeParent',body->'activeParentAfter','touchedParents',body->'touchedParentsAfter')),'UTF8')),'hex');
    IF body->'observations'->2->>'projectionDigest' IS DISTINCT FROM expected_hash THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FINAL_OBSERVATION';
    END IF;
    expected_cash := (prior->>'expectedCashAfter')::numeric;
    expected_quantity := (prior->>'expectedOpenQuantityAfter')::numeric;
    IF delta<>'null'::jsonb THEN
      IF delta->>'parentId' IS DISTINCT FROM prior#>>'{activeParentAfter,orderId}'
        OR (delta->>'fillSequence')::integer IS DISTINCT FROM (prior#>>'{activeParentAfter,fillSequence}')::integer+1
        OR (delta->>'sourceBarIndex')::integer IS DISTINCT FROM (body->>'recordIndex')::integer THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_PARENT';
      END IF;
      expected_cash := expected_cash+(delta->>'netCashEffect')::numeric;
      expected_quantity := expected_quantity+(delta->>'signedQuantity')::numeric;
    END IF;
    IF expected_cash IS DISTINCT FROM (body->>'expectedCashAfter')::numeric OR expected_quantity IS DISTINCT FROM (body->>'expectedOpenQuantityAfter')::numeric
      OR expected_quantity<0 OR (body->>'consumedFillCount')::bigint IS DISTINCT FROM
        (prior->>'consumedFillCount')::bigint+CASE WHEN delta='null'::jsonb THEN 0 ELSE 1 END
      OR body->>'lastConsumedFillId' IS DISTINCT FROM CASE WHEN delta='null'::jsonb THEN prior->>'lastConsumedFillId' ELSE delta->>'fillId' END
      OR (body#>>'{accounting,sequence}')::bigint IS DISTINCT FROM 1+current_row.cycle_sequence+1+(body->>'consumedFillCount')::bigint
      OR (body->>'sourceEventCount')::bigint IS DISTINCT FROM (prior->>'sourceEventCount')::bigint+jsonb_array_length(body->'steps') THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:DELTA';
    END IF;
    expected_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(jsonb_build_object(
      'domain','waia.trader.historical_reconciliation.v1','previous',prior->'sourceChainDigest',
      'cycleId',body->'cycleId','steps',body->'steps','fillDelta',delta)),'UTF8')),'hex');
    IF body->>'sourceChainDigest' IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:SOURCE_CHAIN'; END IF;
    SELECT array_agg(a.id ORDER BY a.accounting_sequence) INTO actual_ids FROM (
      SELECT id,accounting_sequence FROM public.trader_accounting_frontier
      WHERE organization_id=scope_org AND account_key=scope_account AND run_id=scope_run
        AND accounting_sequence>(prior#>>'{accounting,sequence}')::bigint
        AND accounting_sequence<=(body#>>'{accounting,sequence}')::bigint
      ORDER BY accounting_sequence LIMIT 3) a;
    SELECT array_agg((value->>'id')::uuid ORDER BY ordinality) INTO expected_ids FROM jsonb_array_elements(body->'steps') WITH ORDINALITY;
    IF actual_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ACCOUNTING_MEMBERSHIP'; END IF;
    FOR step,source_sequence IN SELECT value,ordinality::integer FROM jsonb_array_elements(body->'steps') WITH ORDINALITY LOOP
      SELECT octet_length((jsonb_build_object('id',a.id,'digest',a.semantic_content_digest,'sequence',a.accounting_sequence,
        'sourceFillId',a.source_fill_id,'economicsDigest',a.source_economics_digest,'organizationId',a.organization_id,
        'accountId',a.account_key,'runId',a.run_id,'cash',a.cash,'positions',a.position_quantity_json))::text) INTO bytes FROM public.trader_accounting_frontier a
        WHERE a.organization_id=scope_org AND a.account_key=scope_account AND a.run_id=scope_run AND a.id=(step->>'id')::uuid;
      IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
      total_bytes:=total_bytes+8*bytes;
      IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
      SELECT jsonb_build_object('id',a.id,'digest',a.semantic_content_digest,'sequence',a.accounting_sequence,
        'sourceFillId',a.source_fill_id,'economicsDigest',a.source_economics_digest,'organizationId',a.organization_id,
        'accountId',a.account_key,'runId',a.run_id,'cash',a.cash,'positions',a.position_quantity_json) INTO projected FROM public.trader_accounting_frontier a
        WHERE a.organization_id=scope_org AND a.account_key=scope_account AND a.run_id=scope_run AND a.id=(step->>'id')::uuid;
      IF NOT FOUND OR projected IS DISTINCT FROM step-ARRAY['consumedFillCount','lastConsumedFillId']
        OR (step->>'sequence')::bigint IS DISTINCT FROM (prior#>>'{accounting,sequence}')::bigint+source_sequence
        OR (step->>'cash')::numeric IS DISTINCT FROM expected_cash
        OR (step->>'consumedFillCount')::bigint IS DISTINCT FROM (body->>'consumedFillCount')::bigint
        OR step->>'lastConsumedFillId' IS DISTINCT FROM body->>'lastConsumedFillId'
        OR (COALESCE(step->'positions'->>current_row.symbol,'0'))::numeric IS DISTINCT FROM expected_quantity
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(step->'positions') AS key WHERE key<>current_row.symbol) THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ACCOUNTING_CONTENT';
      END IF;
      IF source_sequence=1 AND delta<>'null'::jsonb AND (step->>'sourceFillId' IS DISTINCT FROM delta->>'fillId'
        OR step->>'id' IS DISTINCT FROM delta->>'fillAccountingId' OR step->>'digest' IS DISTINCT FROM delta->>'fillAccountingDigest'
        OR (step->>'sequence')::bigint IS DISTINCT FROM (delta->>'fillAccountingSequence')::bigint
        OR step->>'economicsDigest' IS DISTINCT FROM delta->>'economicsDigest') THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_ACCOUNTING';
      END IF;
    END LOOP;
    -- Inception is selected by its exact native ID; no new source-authority relation is read by this definer.
    IF NOT EXISTS(SELECT 1 FROM public.trader_accounting_frontier a WHERE a.organization_id=scope_org
      AND a.account_key=scope_account AND a.run_id=scope_run AND a.accounting_sequence=1
      AND a.id=(genesis->>'inceptionAccountingId')::uuid AND a.semantic_content_digest=genesis->>'inceptionAccountingDigest'
      AND a.cash=genesis->>'startingCash' AND a.source_fill_id IS NULL AND a.position_quantity_json='{}'::jsonb) THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:INCEPTION';
    END IF;
    member_count := 0;
    FOR parent IN SELECT value FROM jsonb_array_elements(body->'touchedParentsAfter') LOOP
      IF jsonb_typeof(parent->'fillReferences') IS DISTINCT FROM 'array' OR jsonb_array_length(parent->'fillReferences')>3
        OR parent->>'organizationId' IS DISTINCT FROM scope_org::text OR parent->>'accountId' IS DISTINCT FROM scope_account
        OR parent->>'runId' IS DISTINCT FROM scope_run OR parent->>'symbol' IS DISTINCT FROM current_row.symbol
        OR (parent->>'eligibleBarsSeen')::integer NOT BETWEEN 0 AND 3
        OR (parent->>'fillSequence')::integer NOT BETWEEN 0 AND 3
        OR (parent->>'receiptDigest' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_CAPACITY';
      END IF;
      SELECT octet_length((jsonb_build_object('orderId',o.id::text,'organizationId',o.organization_id::text,
  'accountId',o.historical_account_key,'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,
  'quantity',o.quantity,'filledQuantity',o.filled_quantity,'state',o.state,'stateVersion',o.state_version,
  'venue',o.venue,'executionMode',o.execution_mode,'credentialId',o.credential_id::text,
  'clientOrderId',o.client_order_id,'idempotencyKey',o.idempotency_key,'riskDecisionId',o.risk_decision_id,
  'allocationDecisionId',o.allocation_decision_id,'type',o.type,'price',o.price,
  'riskAllowanceId',o.risk_allowance_id::text,'riskAllowanceBindingDigest',o.risk_allowance_binding_digest))::text) INTO bytes FROM public.trader_orders o WHERE o.organization_id=scope_org AND o.historical_account_key=scope_account AND o.historical_run_id=scope_run AND o.id=(parent->>'orderId')::uuid;
      IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
      total_bytes:=total_bytes+8*bytes;
      IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
      SELECT jsonb_build_object('orderId',o.id::text,'organizationId',o.organization_id::text,
  'accountId',o.historical_account_key,'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,
  'quantity',o.quantity,'filledQuantity',o.filled_quantity,'state',o.state,'stateVersion',o.state_version,
  'venue',o.venue,'executionMode',o.execution_mode,'credentialId',o.credential_id::text,
  'clientOrderId',o.client_order_id,'idempotencyKey',o.idempotency_key,'riskDecisionId',o.risk_decision_id,
  'allocationDecisionId',o.allocation_decision_id,'type',o.type,'price',o.price,
  'riskAllowanceId',o.risk_allowance_id::text,'riskAllowanceBindingDigest',o.risk_allowance_binding_digest) INTO projected FROM public.trader_orders o WHERE o.organization_id=scope_org AND o.historical_account_key=scope_account AND o.historical_run_id=scope_run AND o.id=(parent->>'orderId')::uuid;
      SELECT projected->>'orderId' AS id,projected->>'state' AS state,(projected->>'stateVersion')::integer AS state_version,
        projected->>'filledQuantity' AS filled_quantity,projected->>'quantity' AS quantity,projected->>'symbol' AS symbol,
        projected->>'side' AS side,projected->>'venue' AS venue,projected->>'executionMode' AS execution_mode,
        projected->>'credentialId' AS credential_id,projected->>'type' AS type,projected->>'price' AS price,
        projected->>'riskAllowanceId' AS risk_allowance_id,projected->>'riskAllowanceBindingDigest' AS risk_allowance_binding_digest INTO actual_order;
      expected_hash := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(projected-ARRAY['filledQuantity','state','stateVersion']),'UTF8')),'hex');
      IF expected_hash IS DISTINCT FROM parent->>'creationDigest'
        OR actual_order.state::text IS DISTINCT FROM parent->>'state' OR actual_order.state_version IS DISTINCT FROM (parent->>'stateVersion')::integer
        OR actual_order.filled_quantity IS DISTINCT FROM parent->>'filledQuantity' OR actual_order.quantity IS DISTINCT FROM parent->>'quantity'
        OR actual_order.symbol IS DISTINCT FROM current_row.symbol OR actual_order.side::text IS DISTINCT FROM parent->>'side'
        OR actual_order.venue<>'HISTORICAL_SIMULATED_EXCHANGE' OR actual_order.execution_mode<>'mock'
        OR actual_order.credential_id IS NOT NULL OR actual_order.type<>'market' OR actual_order.price IS NOT NULL
        OR actual_order.risk_allowance_id IS NOT NULL OR actual_order.risk_allowance_binding_digest IS NOT NULL
        OR (parent->>'filledQuantity')::numeric+(parent->>'remainingQuantity')::numeric IS DISTINCT FROM (parent->>'quantity')::numeric THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_CONTENT';
      END IF;
      SELECT octet_length((jsonb_build_object('id',e.id::text,'orderId',e.order_id::text,
      'sequence',e.seq,'fromState',e.from_state,'toState',e.to_state,'eventType',e.event_type,
      'payload',e.payload,'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text) INTO bytes FROM public.trader_order_events e
        WHERE e.organization_id=scope_org AND e.order_id=actual_order.id::uuid ORDER BY e.seq DESC LIMIT 1;
      IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
      total_bytes:=total_bytes+8*bytes;
      IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
      SELECT jsonb_build_object('id',e.id::text,'orderId',e.order_id::text,
      'sequence',e.seq,'fromState',e.from_state,'toState',e.to_state,'eventType',e.event_type,
      'payload',e.payload,'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) INTO projected FROM public.trader_order_events e
        WHERE e.organization_id=scope_org AND e.order_id=actual_order.id::uuid ORDER BY e.seq DESC LIMIT 1;
      IF NOT FOUND OR projected->>'id' IS DISTINCT FROM parent#>>'{stateEvent,id}'
        OR projected->>'toState' IS DISTINCT FROM parent->>'state'
        OR (projected->>'sequence')::integer IS DISTINCT FROM (parent#>>'{stateEvent,sequence}')::integer
        OR encode(sha256(convert_to(public.waia_canonical_jsonb_v1(projected),'UTF8')),'hex') IS DISTINCT FROM parent#>>'{stateEvent,digest}' THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PARENT_EVENT';
      END IF;
      -- Both independent indexed source sets are compared to exact fill references.
      SELECT array_agg(id ORDER BY id) INTO actual_ids FROM (SELECT id FROM public.trader_fills
        WHERE organization_id=scope_org AND order_id=actual_order.id::uuid ORDER BY id LIMIT 4) f;
      SELECT array_agg((value->>'fillId')::uuid ORDER BY (value->>'fillId')::uuid) INTO expected_ids
        FROM jsonb_array_elements(parent->'fillReferences');
      IF actual_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_SET'; END IF;
      SELECT array_agg(fill_id ORDER BY fill_id) INTO actual_ids FROM (SELECT fill_id FROM public.trader_fill_execution_economics
        WHERE organization_id=scope_org AND order_id=actual_order.id::uuid ORDER BY fill_id LIMIT 4) e;
      IF actual_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ECONOMICS_SET'; END IF;
      IF jsonb_array_length(parent->'fillReferences') IS DISTINCT FROM (parent->>'fillSequence')::integer THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_SEQUENCE';
      END IF;
      FOR ref IN SELECT value FROM jsonb_array_elements(parent->'fillReferences') LOOP
        SELECT octet_length((jsonb_build_object('fillId',f.id::text,
      'parentId',f.order_id::text,'organizationId',f.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,'quantity',f.quantity,
      'price',f.price,'fee',f.fee,'feeAsset',f.fee_asset,'exchangeTradeId',f.exchange_trade_id,
      'executedAt',(extract(epoch FROM f.executed_at)*1000)::bigint))::text) INTO bytes FROM public.trader_fills f JOIN public.trader_orders o
          ON o.organization_id=f.organization_id AND o.id=f.order_id
          WHERE f.organization_id=scope_org AND f.id=(ref->>'fillId')::uuid AND f.order_id=actual_order.id::uuid;
        IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
        total_bytes:=total_bytes+8*bytes;
        IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
        SELECT jsonb_build_object('fillId',f.id::text,
      'parentId',f.order_id::text,'organizationId',f.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,'quantity',f.quantity,
      'price',f.price,'fee',f.fee,'feeAsset',f.fee_asset,'exchangeTradeId',f.exchange_trade_id,
      'executedAt',(extract(epoch FROM f.executed_at)*1000)::bigint) INTO projected FROM public.trader_fills f JOIN public.trader_orders o
          ON o.organization_id=f.organization_id AND o.id=f.order_id
          WHERE f.organization_id=scope_org AND f.id=(ref->>'fillId')::uuid AND f.order_id=actual_order.id::uuid;
        IF NOT FOUND OR encode(sha256(convert_to(public.waia_canonical_jsonb_v1(projected),'UTF8')),'hex') IS DISTINCT FROM ref->>'fillSourceDigest' THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_CONTENT';
        END IF;
        SELECT octet_length((jsonb_build_object('fillId',e.fill_id::text,
      'parentId',e.order_id::text,'organizationId',e.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
      'economicsRowId',e.id::text,'economicsDigest',e.economics_content_digest,'netCashEffect',e.net_cash_effect,
      'fillSequence',e.fill_sequence,'sourceBarIndex',e.source_bar_index,
      'exchangeTradeId',e.exchange_trade_id,'schemaVersion',e.schema_version,
      'sourceEconomics',jsonb_build_object('executionFactKind',e.execution_fact_kind,
        'grossFillPrice',e.gross_fill_price,'grossNotional',e.gross_notional,'feeAmount',e.fee_amount,
        'feeAsset',e.fee_asset,'spreadCost',e.spread_cost,'impactSlippageCost',e.impact_slippage_cost,
        'totalExecutionCost',e.total_execution_cost,'netFillPrice',e.net_fill_price,'netCashEffect',e.net_cash_effect,
        'executionModelId',e.execution_model_id,'executionModelSchemaVersion',e.execution_model_schema_version,
        'simulatorId',e.simulator_id,'simulatorVersion',e.simulator_version,'sourceBarIndex',e.source_bar_index,
        'fillSequence',e.fill_sequence,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
        'remainingQuantityAfter',e.remaining_quantity_after,'submitLatencyMs',e.submit_latency_ms,'cancelLatencyMs',e.cancel_latency_ms,
        'economicsContentDigest',e.economics_content_digest,'sourceBarTimestamp',(extract(epoch FROM e.source_bar_timestamp)*1000)::bigint,
        'acceptedAt',(extract(epoch FROM e.accepted_at)*1000)::bigint,'fillTimestamp',(extract(epoch FROM e.fill_timestamp)*1000)::bigint)))::text) INTO bytes FROM public.trader_fill_execution_economics e JOIN public.trader_orders o
          ON o.organization_id=e.organization_id AND o.id=e.order_id
          WHERE e.organization_id=scope_org AND e.fill_id=(ref->>'fillId')::uuid AND e.order_id=actual_order.id::uuid;
        IF bytes IS NULL OR bytes>1048576 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE_OR_MISSING'; END IF;
        total_bytes:=total_bytes+16*bytes;
        IF total_bytes>8388608 THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:RESOURCE_ENVELOPE'; END IF;
        SELECT jsonb_build_object('fillId',e.fill_id::text,
      'parentId',e.order_id::text,'organizationId',e.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
      'economicsRowId',e.id::text,'economicsDigest',e.economics_content_digest,'netCashEffect',e.net_cash_effect,
      'fillSequence',e.fill_sequence,'sourceBarIndex',e.source_bar_index,
      'exchangeTradeId',e.exchange_trade_id,'schemaVersion',e.schema_version,
      'sourceEconomics',jsonb_build_object('executionFactKind',e.execution_fact_kind,
        'grossFillPrice',e.gross_fill_price,'grossNotional',e.gross_notional,'feeAmount',e.fee_amount,
        'feeAsset',e.fee_asset,'spreadCost',e.spread_cost,'impactSlippageCost',e.impact_slippage_cost,
        'totalExecutionCost',e.total_execution_cost,'netFillPrice',e.net_fill_price,'netCashEffect',e.net_cash_effect,
        'executionModelId',e.execution_model_id,'executionModelSchemaVersion',e.execution_model_schema_version,
        'simulatorId',e.simulator_id,'simulatorVersion',e.simulator_version,'sourceBarIndex',e.source_bar_index,
        'fillSequence',e.fill_sequence,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
        'remainingQuantityAfter',e.remaining_quantity_after,'submitLatencyMs',e.submit_latency_ms,'cancelLatencyMs',e.cancel_latency_ms,
        'economicsContentDigest',e.economics_content_digest,'sourceBarTimestamp',(extract(epoch FROM e.source_bar_timestamp)*1000)::bigint,
        'acceptedAt',(extract(epoch FROM e.accepted_at)*1000)::bigint,'fillTimestamp',(extract(epoch FROM e.fill_timestamp)*1000)::bigint)) INTO source_projection FROM public.trader_fill_execution_economics e JOIN public.trader_orders o
          ON o.organization_id=e.organization_id AND o.id=e.order_id
          WHERE e.organization_id=scope_org AND e.fill_id=(ref->>'fillId')::uuid AND e.order_id=actual_order.id::uuid;
        IF NOT FOUND OR source_projection->>'economicsRowId' IS DISTINCT FROM ref->>'economicsRowId'
          OR source_projection->>'economicsDigest' IS DISTINCT FROM ref->>'economicsDigest'
          OR encode(sha256(convert_to(public.waia_canonical_jsonb_v1(source_projection),'UTF8')),'hex') IS DISTINCT FROM ref->>'economicsSourceDigest'
          OR projected->>'price' IS DISTINCT FROM source_projection#>>'{sourceEconomics,netFillPrice}'
          OR projected->>'fee' IS DISTINCT FROM source_projection#>>'{sourceEconomics,feeAmount}'
          OR projected->>'feeAsset' IS DISTINCT FROM source_projection#>>'{sourceEconomics,feeAsset}'
          OR projected->>'exchangeTradeId' IS DISTINCT FROM source_projection->>'exchangeTradeId'
          OR projected->'executedAt' IS DISTINCT FROM source_projection#>'{sourceEconomics,fillTimestamp}'
          OR EXISTS(SELECT 1 FROM public.trader_fills f WHERE f.organization_id=scope_org AND f.id=(ref->>'fillId')::uuid
            AND f.executed_at IS DISTINCT FROM date_trunc('milliseconds',f.executed_at))
          OR EXISTS(SELECT 1 FROM public.trader_fill_execution_economics e WHERE e.organization_id=scope_org AND e.fill_id=(ref->>'fillId')::uuid
            AND (e.fill_timestamp IS DISTINCT FROM date_trunc('milliseconds',e.fill_timestamp)
              OR e.accepted_at IS DISTINCT FROM date_trunc('milliseconds',e.accepted_at)
              OR e.source_bar_timestamp IS DISTINCT FROM date_trunc('milliseconds',e.source_bar_timestamp)))
          OR projected->>'quantity' IS DISTINCT FROM source_projection->>'quantity' THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ECONOMICS_CONTENT';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prior#>'{activeParentAfter,fillReferences}','[]'::jsonb)) old
          WHERE old->>'fillId'=ref->>'fillId') THEN
          member_count := member_count+1;
          current_fill:=projected; current_economics:=source_projection;
          IF delta='null'::jsonb OR delta->>'fillId' IS DISTINCT FROM ref->>'fillId'
            OR delta->>'economicsRowId' IS DISTINCT FROM ref->>'economicsRowId'
            OR delta->>'economicsDigest' IS DISTINCT FROM ref->>'economicsDigest'
            OR delta->>'parentId' IS DISTINCT FROM actual_order.id::text
            OR (delta->>'netCashEffect')::numeric IS DISTINCT FROM (source_projection->>'netCashEffect')::numeric
            OR (delta->>'fillSequence')::integer IS DISTINCT FROM (source_projection->>'fillSequence')::integer
            OR (delta->>'sourceBarIndex')::integer IS DISTINCT FROM (source_projection->>'sourceBarIndex')::integer
            OR (delta->>'signedQuantity')::numeric IS DISTINCT FROM (projected->>'quantity')::numeric*
              CASE WHEN actual_order.side='buy' THEN 1 ELSE -1 END THEN
            RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_DELTA';
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    IF member_count<>CASE WHEN delta='null'::jsonb THEN 0 ELSE 1 END THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FILL_DELTA_MEMBERSHIP';
    END IF;
    SELECT array_agg(id ORDER BY id) INTO active_ids FROM (SELECT id FROM public.trader_orders
      WHERE organization_id=scope_org AND historical_account_key=scope_account AND historical_run_id=scope_run
        AND state NOT IN ('FILLED','CANCELLED','REJECTED','EXPIRED','FAILED') ORDER BY id LIMIT 2) o;
    IF active_ids IS DISTINCT FROM CASE WHEN body->'activeParentAfter'='null'::jsonb THEN NULL::uuid[]
      ELSE ARRAY[(body#>>'{activeParentAfter,orderId}')::uuid] END THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:ACTIVE_PARENT';
    END IF;
    -- The INSERT CHECK bound this small column to all original detail leaves.
    -- No stored artifacts_json/accounting snapshot history is decoded here.
    actual_count:=(effects_source->>'artifactCount')::integer;
    IF actual_count IS NULL OR actual_count NOT IN (1,2) THEN RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:EFFECT_CAPACITY'; END IF;
    member_count:=0;
    FOR detail IN SELECT value->'detail' FROM jsonb_array_elements(effects_source->'artifacts') WHERE value->'detail'<>'null'::jsonb LOOP
      member_count:=member_count+1;
      IF member_count>1 OR delta='null'::jsonb OR current_fill IS NULL OR current_economics IS NULL THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:DETAIL_MEMBERSHIP';
      END IF;
      IF detail->>'accountingId' IS DISTINCT FROM delta->>'fillAccountingId'
        OR detail->>'accountingDigest' IS DISTINCT FROM delta->>'fillAccountingDigest'
        OR detail#>>'{evidence,fillId}' IS DISTINCT FROM current_fill->>'fillId'
        OR detail#>>'{event,organizationId}' IS DISTINCT FROM scope_org::text
        OR detail#>>'{event,orderId}' IS DISTINCT FROM current_fill->>'parentId'
        OR detail#>>'{event,sliceQuantity}' IS DISTINCT FROM current_fill->>'quantity'
        OR detail#>>'{event,symbol}' IS DISTINCT FROM current_economics->>'symbol'
        OR detail#>>'{event,side}' IS DISTINCT FROM current_economics->>'side'
        OR (detail#>>'{event,fillSequence}')::integer IS DISTINCT FROM (current_economics->>'fillSequence')::integer
        OR (detail#>>'{event,sourceBarIndex}')::integer IS DISTINCT FROM (current_economics->>'sourceBarIndex')::integer
        OR (extract(epoch FROM (detail#>>'{event,acceptedAt}')::timestamptz)*1000) IS DISTINCT FROM (current_economics#>>'{sourceEconomics,acceptedAt}')::numeric
        OR (extract(epoch FROM (detail#>>'{event,fillTimestamp}')::timestamptz)*1000) IS DISTINCT FROM (current_fill->>'executedAt')::numeric
        OR (extract(epoch FROM (detail#>>'{event,sourceBar,barCloseTime}')::timestamptz)*1000) IS DISTINCT FROM (current_economics#>>'{sourceEconomics,sourceBarTimestamp}')::numeric
        OR detail#>>'{event,grossFillPrice}' IS DISTINCT FROM current_economics#>>'{sourceEconomics,grossFillPrice}'
        OR detail#>>'{event,remainingQuantityAfter}' IS DISTINCT FROM current_economics#>>'{sourceEconomics,remainingQuantityAfter}' THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PRODUCED_DETAIL';
      END IF;
      -- Reuse the earlier exact physical economics projection, including time.
      IF detail->'economics'-ARRAY['sourceBarTimestamp','acceptedAt','fillTimestamp'] IS DISTINCT FROM
          current_economics->'sourceEconomics'-ARRAY['sourceBarTimestamp','acceptedAt','fillTimestamp']
        OR (extract(epoch FROM (detail#>>'{economics,sourceBarTimestamp}')::timestamptz)*1000) IS DISTINCT FROM (current_economics#>>'{sourceEconomics,sourceBarTimestamp}')::numeric
        OR (extract(epoch FROM (detail#>>'{economics,acceptedAt}')::timestamptz)*1000) IS DISTINCT FROM (current_economics#>>'{sourceEconomics,acceptedAt}')::numeric
        OR (extract(epoch FROM (detail#>>'{economics,fillTimestamp}')::timestamptz)*1000) IS DISTINCT FROM (current_economics#>>'{sourceEconomics,fillTimestamp}')::numeric THEN
        RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:PRODUCED_ECONOMICS';
      END IF;
    END LOOP;
    IF member_count<>CASE WHEN delta='null'::jsonb THEN 0 ELSE 1 END OR total_bytes>8388608 THEN
      RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:DETAIL_MEMBERSHIP_OR_CAPACITY';
    END IF;
    -- Every queued source trigger must be covered; a valid older companion is never enough.
    CASE TG_TABLE_NAME
      WHEN 'trader_orders' THEN
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'touchedParentsAfter') p WHERE p->>'orderId'=NEW.id::text) THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_ORDER';
        END IF;
      WHEN 'trader_order_events' THEN
        SELECT value INTO parent FROM jsonb_array_elements(body->'touchedParentsAfter') WHERE value->>'orderId'=NEW.order_id::text;
        IF NOT FOUND OR NEW.seq>(parent#>>'{stateEvent,sequence}')::integer
          OR NEW.seq<=CASE WHEN prior#>>'{activeParentAfter,orderId}'=NEW.order_id::text
            THEN (prior#>>'{activeParentAfter,stateEvent,sequence}')::integer ELSE -1 END THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_EVENT';
        END IF;
      WHEN 'trader_fills' THEN
        IF NEW.id::text IS DISTINCT FROM delta->>'fillId' OR NEW.order_id::text IS DISTINCT FROM delta->>'parentId' THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_FILL';
        END IF;
      WHEN 'trader_fill_execution_economics' THEN
        IF NEW.id::text IS DISTINCT FROM delta->>'economicsRowId' OR NEW.fill_id::text IS DISTINCT FROM delta->>'fillId'
          OR NEW.order_id::text IS DISTINCT FROM delta->>'parentId' THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_ECONOMICS';
        END IF;
      WHEN 'trader_accounting_frontier' THEN
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'steps') a WHERE a->>'id'=NEW.id::text)
          AND NOT (NEW.accounting_sequence=1 AND NEW.id::text=genesis->>'inceptionAccountingId') THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_ACCOUNTING';
        END IF;
      WHEN 'trader_historical_reconciliation_scope_mode_v1' THEN
        IF mode_row.writer_xid<>pg_current_xact_id()::text OR current_row.cycle_sequence<>0 THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:MODE_GENESIS_CLOSURE';
        END IF;
      WHEN 'trader_historical_reconciliation_frontier_v1' THEN
        IF NEW.id<>current_row.id AND NEW.id<>genesis_row.id THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:FRONTIER_TRANSACTION';
        END IF;
      WHEN 'trader_historical_simulation_modeled_evidence_v2' THEN
        IF NEW.reason_ledger_entry_id IS DISTINCT FROM checkpoint_row.ledger_entry_id THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_EVIDENCE';
        END IF;
      WHEN 'trader_historical_simulation_resume_checkpoint_v2', 'trader_historical_simulation_resume_stage_link_v2',
        'trader_historical_simulation_resume_snapshot_link_v2' THEN
        IF NEW.committed_cycle_sequence<>current_row.cycle_sequence THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_CHECKPOINT';
        END IF;
      ELSE
        IF NEW.cycle_sequence<>current_row.cycle_sequence THEN
          RAISE EXCEPTION 'HISTORICAL_RECONCILIATION_REFUSED:UNCOVERED_CYCLE_SOURCE';
        END IF;
    END CASE;
  END LOOP;
  IF TG_WHEN='AFTER' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_historical_reconciliation_verify_v1() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER ab_historical_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.trader_orders
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT OR UPDATE ON public.trader_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE TRIGGER ab_historical_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.trader_order_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_order_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE TRIGGER ab_historical_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.trader_fills
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_fills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_fill_execution_economics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_accounting_frontier
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_reason_ledger_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_modeled_evidence_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_atomic_stage_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_durable_snapshot_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_resume_checkpoint_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_resume_stage_link_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_simulation_resume_snapshot_link_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE TRIGGER ab_historical_reconciliation_enroll BEFORE INSERT ON public.trader_historical_reconciliation_scope_mode_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_reconciliation_scope_mode_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER historical_reconciliation_closure AFTER INSERT ON public.trader_historical_reconciliation_frontier_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.waia_historical_reconciliation_verify_v1();
--> statement-breakpoint
ALTER TABLE public.trader_historical_reconciliation_scope_mode_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_historical_reconciliation_scope_mode_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.trader_historical_reconciliation_scope_mode_v1 TO waia_historical_runner;
--> statement-breakpoint
CREATE POLICY historical_reconciliation_runner_select ON public.trader_historical_reconciliation_scope_mode_v1
  FOR SELECT TO waia_historical_runner USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_id));
--> statement-breakpoint
CREATE POLICY historical_reconciliation_runner_insert ON public.trader_historical_reconciliation_scope_mode_v1
  FOR INSERT TO waia_historical_runner WITH CHECK (mode='PROFILE' AND organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_id));
--> statement-breakpoint
ALTER TABLE public.trader_historical_reconciliation_frontier_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_historical_reconciliation_frontier_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.trader_historical_reconciliation_frontier_v1 TO waia_historical_runner;
--> statement-breakpoint
CREATE POLICY historical_reconciliation_runner_select ON public.trader_historical_reconciliation_frontier_v1
  FOR SELECT TO waia_historical_runner USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_id));
--> statement-breakpoint
CREATE POLICY historical_reconciliation_runner_insert ON public.trader_historical_reconciliation_frontier_v1
  FOR INSERT TO waia_historical_runner WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_id));
