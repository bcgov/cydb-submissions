ALTER TABLE `submission_attachments` ADD `assessment_index` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `child_youth_first_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `child_youth_middle_names` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `child_youth_last_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `child_youth_dob` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `child_youth_gender` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signatory_first_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signatory_last_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signatory_dob` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signatory_gender` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signatory_relationship` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `primary_phone` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `email` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `screening` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `not_submitting_reasons` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `assessments` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `primary_care_and_control` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `consent_collection` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `consent_disclosure` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `confirm_not_submitting` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `signature` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `date_signed` text NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `dateOfBirth`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `primaryLanguage`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `developmentalConcerns`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `ageOfFirstConcern`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `hasFormalDiagnosis`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `diagnosticStatus`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `assessmentTools`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `communication`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `socialInteraction`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `dailyLivingSkills`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `behaviouralConcerns`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `conditions`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `services`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `weeklyHours`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `informationAccurate`;--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `dataSharingConsent`;