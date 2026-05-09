CREATE TABLE `keyword_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`keyword` text NOT NULL,
	`count` integer NOT NULL,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_hits_submission_keyword_unique` ON `keyword_hits` (`submission_id`,`keyword`);--> statement-breakpoint
CREATE TABLE `ocr_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attachment_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`requeue_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`leased_by` text,
	`leased_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `submission_attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ocr_jobs_status_check" CHECK("ocr_jobs"."status" IN ('queued','processing','succeeded','failed','abandoned'))
);
--> statement-breakpoint
CREATE INDEX `ocr_jobs_status_next_idx` ON `ocr_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `ocr_jobs_attachment_idx` ON `ocr_jobs` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `ocr_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attachment_id` integer NOT NULL,
	`raw_text` text NOT NULL,
	`pages` integer,
	`model_id` text NOT NULL,
	`api_version` text NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `submission_attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ocr_results_attachment_id_unique` ON `ocr_results` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
