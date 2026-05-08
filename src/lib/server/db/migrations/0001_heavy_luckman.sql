CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_roles_role_check" CHECK("user_roles"."role" IN ('admin','cfd_worker','clinician'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_unique` ON `user_roles` (`user_id`,`role`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_uuid` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitter_surname` text,
	`dateOfBirth` text,
	`primaryLanguage` text,
	`developmentalConcerns` integer,
	`ageOfFirstConcern` text,
	`hasFormalDiagnosis` integer,
	`diagnosticStatus` text,
	`assessmentTools` text,
	`communication` text,
	`socialInteraction` text,
	`dailyLivingSkills` text,
	`behaviouralConcerns` text,
	`conditions` text,
	`services` text,
	`weeklyHours` real,
	`informationAccurate` integer NOT NULL,
	`dataSharingConsent` integer NOT NULL,
	`raw_payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "submissions_status_check" CHECK("__new_submissions"."status" IN ('submitted','OCR queued','OCR Error','OCR processed','ready for review','ready for clinician','reviewed','invalid'))
);
--> statement-breakpoint
INSERT INTO `__new_submissions`("id", "submission_uuid", "status", "submitter_surname", "dateOfBirth", "primaryLanguage", "developmentalConcerns", "ageOfFirstConcern", "hasFormalDiagnosis", "diagnosticStatus", "assessmentTools", "communication", "socialInteraction", "dailyLivingSkills", "behaviouralConcerns", "conditions", "services", "weeklyHours", "informationAccurate", "dataSharingConsent", "raw_payload", "created_at", "updated_at") SELECT "id", "submission_uuid", "status", NULL, "dateOfBirth", "primaryLanguage", "developmentalConcerns", "ageOfFirstConcern", "hasFormalDiagnosis", "diagnosticStatus", "assessmentTools", "communication", "socialInteraction", "dailyLivingSkills", "behaviouralConcerns", "conditions", "services", "weeklyHours", "informationAccurate", "dataSharingConsent", "raw_payload", "created_at", "updated_at" FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_submission_uuid_unique` ON `submissions` (`submission_uuid`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `submissions_created_idx` ON `submissions` (`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_surname_idx` ON `submissions` (`submitter_surname`);