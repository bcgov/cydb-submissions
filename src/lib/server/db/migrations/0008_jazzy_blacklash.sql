DROP INDEX `keyword_hits_submission_keyword_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_hits_submission_attachment_keyword_unique` ON `keyword_hits` (`submission_id`,`keyword`,`attachment_id`);--> statement-breakpoint
CREATE INDEX `category1_idx` ON `keyword_hits` (`category1`);--> statement-breakpoint
CREATE INDEX `category2_idx` ON `keyword_hits` (`category2`);--> statement-breakpoint
CREATE INDEX `category3_idx` ON `keyword_hits` (`category3`);--> statement-breakpoint
CREATE INDEX `category4_idx` ON `keyword_hits` (`category4`);--> statement-breakpoint
CREATE INDEX `category5_idx` ON `keyword_hits` (`category5`);--> statement-breakpoint
CREATE INDEX `category6_idx` ON `keyword_hits` (`category6`);--> statement-breakpoint
CREATE INDEX `category7_idx` ON `keyword_hits` (`category7`);--> statement-breakpoint
CREATE INDEX `category8_idx` ON `keyword_hits` (`category8`);--> statement-breakpoint
CREATE INDEX `category9_idx` ON `keyword_hits` (`category9`);--> statement-breakpoint
CREATE INDEX `category10_idx` ON `keyword_hits` (`category10`);--> statement-breakpoint
CREATE INDEX `category11_idx` ON `keyword_hits` (`category11`);--> statement-breakpoint
CREATE INDEX `category12_idx` ON `keyword_hits` (`category12`);--> statement-breakpoint
CREATE INDEX `category13_idx` ON `keyword_hits` (`category13`);