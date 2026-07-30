CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`submission_uuid` text,
	`submission_id` integer,
	`attachment_id` integer,
	`decision` text,
	`reason_id` integer,
	`job_id` integer,
	`actor_user_id` text,
	`actor_role` text,
	`target_user_id` text,
	`target_role` text,
	`route` text,
	`request_id` text,
	`reason` text,
	`error_class` text,
	`new_status` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_submission_idx` ON `audit_logs` (`submission_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_attachment_idx` ON `audit_logs` (`attachment_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_event_idx` ON `audit_logs` (`event`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);