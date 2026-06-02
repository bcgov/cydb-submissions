ALTER TABLE `submissions` ADD `search_indexed_at` text;--> statement-breakpoint
CREATE INDEX `submissions_search_indexed_idx` ON `submissions` (`search_indexed_at`);