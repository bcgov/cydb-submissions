PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_uuid` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitter_surname` text,
	`child_youth_first_name` text NOT NULL,
	`child_youth_middle_names` text,
	`child_youth_last_name` text NOT NULL,
	`child_youth_dob` text NOT NULL,
	`child_youth_gender` text NOT NULL,
	`signatory_first_name` text NOT NULL,
	`signatory_last_name` text NOT NULL,
	`signatory_dob` text NOT NULL,
	`signatory_gender` text NOT NULL,
	`signatory_relationship` text NOT NULL,
	`primary_phone` text NOT NULL,
	`email` text NOT NULL,
	`screening` text NOT NULL,
	`not_submitting_reasons` text,
	`assessments` text,
	`primary_care_and_control` integer NOT NULL,
	`consent_collection` integer,
	`consent_disclosure` integer,
	`confirm_not_submitting` integer,
	`signature` text NOT NULL,
	`date_signed` text NOT NULL,
	`raw_payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`search_indexed_at` text,
	`decision` text,
	`decision_reasons` text,
	`decided_by` text,
	`decided_at` text,
	`accept_tier` text,
	`level_of_need_summary` text,
	CONSTRAINT "submissions_status_check" CHECK("__new_submissions"."status" IN ('submitted','OCR queued','OCR Error','OCR processed','ready for review','ready for clinician','ready for policy','provisionally eligible','reviewed','accepted','rejected','invalid','opt-out','duplicate')),
	CONSTRAINT "submissions_decision_check" CHECK("__new_submissions"."decision" IS NULL OR "__new_submissions"."decision" IN ('accepted','rejected')),
	CONSTRAINT "submissions_accept_check" CHECK("__new_submissions"."decision" IS NULL OR "__new_submissions"."decision" IN ('rejected') OR "__new_submissions"."accept_tier" IS NULL OR "__new_submissions"."accept_tier" IN ('tier one', 'tier two'))
);
--> statement-breakpoint
INSERT INTO `__new_submissions`("id", "submission_uuid", "status", "submitter_surname", "child_youth_first_name", "child_youth_middle_names", "child_youth_last_name", "child_youth_dob", "child_youth_gender", "signatory_first_name", "signatory_last_name", "signatory_dob", "signatory_gender", "signatory_relationship", "primary_phone", "email", "screening", "not_submitting_reasons", "assessments", "primary_care_and_control", "consent_collection", "consent_disclosure", "confirm_not_submitting", "signature", "date_signed", "raw_payload", "created_at", "updated_at", "search_indexed_at", "decision", "decision_reasons", "decided_by", "decided_at", "accept_tier", "level_of_need_summary") SELECT "id", "submission_uuid", "status", "submitter_surname", "child_youth_first_name", "child_youth_middle_names", "child_youth_last_name", "child_youth_dob", "child_youth_gender", "signatory_first_name", "signatory_last_name", "signatory_dob", "signatory_gender", "signatory_relationship", "primary_phone", "email", "screening", "not_submitting_reasons", "assessments", "primary_care_and_control", "consent_collection", "consent_disclosure", "confirm_not_submitting", "signature", "date_signed", "raw_payload", "created_at", "updated_at", "search_indexed_at", "decision", "decision_reasons", "decided_by", "decided_at", "accept_tier", "level_of_need_summary" FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_submission_uuid_unique` ON `submissions` (`submission_uuid`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `submissions_created_idx` ON `submissions` (`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_surname_idx` ON `submissions` (`submitter_surname`);--> statement-breakpoint
CREATE INDEX `submissions_search_indexed_idx` ON `submissions` (`search_indexed_at`);