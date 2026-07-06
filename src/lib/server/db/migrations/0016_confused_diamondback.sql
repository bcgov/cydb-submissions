CREATE INDEX `submissions_child_first_name_idx` ON `submissions` (`child_youth_first_name`);--> statement-breakpoint
CREATE INDEX `submissions_child_last_name_idx` ON `submissions` (`child_youth_last_name`);--> statement-breakpoint
UPDATE `submissions` SET `search_indexed_at` = NULL;--> statement-breakpoint
INSERT INTO `system_state` (`key`, `value`, `updated_at`) VALUES ('manticore_rebuild_needed', '1', CURRENT_TIMESTAMP) ON CONFLICT(`key`) DO UPDATE SET `value` = '1', `updated_at` = CURRENT_TIMESTAMP;
