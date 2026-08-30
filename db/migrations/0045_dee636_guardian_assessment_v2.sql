CREATE TABLE `trader_guardian_assessments_v2` (
  `assessment_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `position_id` text NOT NULL,
  `lot_id` text NOT NULL,
  `symbol` text NOT NULL,
  `opening_causal_lineage_digest` text NOT NULL,
  `reality_frontier_id` text NOT NULL,
  `reality_content_digest` text NOT NULL,
  `qualified_evidence_bundle_id` text NOT NULL,
  `qualified_evidence_content_digest` text NOT NULL,
  `information_sufficiency_profile` text NOT NULL CHECK (`information_sufficiency_profile` = 'OPEN_POSITION_REASSESSMENT'),
  `open_position_sufficiency` text NOT NULL CHECK (`open_position_sufficiency` IN ('SUFFICIENT', 'INSUFFICIENT')),
  `new_opportunity_sufficiency` text NOT NULL CHECK (`new_opportunity_sufficiency` IN ('SUFFICIENT', 'INSUFFICIENT')),
  `recommendation` text NOT NULL CHECK (`recommendation` IN ('HOLD', 'REDUCE_PARTIAL', 'REDUCE_FULL')),
  `target_reduction_bps` integer NOT NULL CHECK (
    (`recommendation` = 'HOLD' AND `target_reduction_bps` = 0)
    OR (`recommendation` = 'REDUCE_PARTIAL' AND `target_reduction_bps` > 0 AND `target_reduction_bps` < 10000)
    OR (`recommendation` = 'REDUCE_FULL' AND `target_reduction_bps` = 10000)
  ),
  `reason_codes_json` text NOT NULL CHECK (json_valid(`reason_codes_json`) AND json_type(`reason_codes_json`) = 'array'),
  `content_digest` text NOT NULL,
  `canonical_json` text NOT NULL CHECK (json_valid(`canonical_json`) AND json_type(`canonical_json`) = 'object'),
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`position_id`,`organization_id`) REFERENCES `trader_trades`(`id`,`organization_id`),
  FOREIGN KEY (`lot_id`,`organization_id`) REFERENCES `trader_position_lots`(`id`,`organization_id`),
  CHECK (length(`content_digest`) = 64 AND `content_digest` NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(`opening_causal_lineage_digest`) = 64 AND `opening_causal_lineage_digest` NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(`reality_content_digest`) = 64 AND `reality_content_digest` NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(`qualified_evidence_content_digest`) = 64 AND `qualified_evidence_content_digest` NOT GLOB '*[^0-9a-f]*'),
  CHECK (`assessment_id` = 'guardian-assessment-v2:' || `content_digest`),
  CHECK (`open_position_sufficiency` = 'SUFFICIENT' OR `recommendation` = 'HOLD')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_guardian_assessments_v2_id_org_unique`
  ON `trader_guardian_assessments_v2` (`assessment_id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_guardian_assessments_v2_org_digest_unique`
  ON `trader_guardian_assessments_v2` (`organization_id`,`content_digest`);
--> statement-breakpoint
CREATE INDEX `trader_guardian_assessments_v2_org_lot_idx`
  ON `trader_guardian_assessments_v2` (`organization_id`,`lot_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `trader_guardian_assessments_v2_append_only_update_guard`
BEFORE UPDATE ON `trader_guardian_assessments_v2` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'GUARDIAN_ASSESSMENT_V2_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `trader_guardian_assessments_v2_append_only_delete_guard`
BEFORE DELETE ON `trader_guardian_assessments_v2` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'GUARDIAN_ASSESSMENT_V2_APPEND_ONLY'); END;

