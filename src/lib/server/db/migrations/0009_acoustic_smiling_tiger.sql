CREATE TABLE `submission_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_claims_unique` ON `submission_claims` (`user_id`,`submission_id`);--> statement-breakpoint
ALTER TABLE `invalid_submissions` ADD `search_indexed_at` text;