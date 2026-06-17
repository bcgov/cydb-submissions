ALTER TABLE `keyword_hits` ADD `attachment_id` integer NOT NULL REFERENCES submission_attachments(id);--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category1` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category2` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category3` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category4` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category5` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category6` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category7` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category8` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category9` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category10` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category11` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category12` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keyword_hits` ADD `category13` integer DEFAULT 0 NOT NULL;