ALTER TABLE `twin_dialogue_turns` ADD COLUMN `embedding_json` text;
--> statement-breakpoint
ALTER TABLE `twin_dialogue_turns` ADD COLUMN `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `diary_entries` ADD COLUMN `embedding_json` text;
--> statement-breakpoint
ALTER TABLE `diary_entries` ADD COLUMN `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `scenario_answers` ADD COLUMN `embedding_json` text;
--> statement-breakpoint
ALTER TABLE `scenario_answers` ADD COLUMN `embedding_model` text;
