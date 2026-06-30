PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_revoked_user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`reason` text,
	`revoked_by` text NOT NULL,
	`revoked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revoked_user_roles_role_check" CHECK("__new_revoked_user_roles"."role" IN ('admin','cfd_worker','clinician','validator'))
);
--> statement-breakpoint
INSERT INTO `__new_revoked_user_roles`("id", "user_id", "role", "reason", "revoked_by", "revoked_at") SELECT "id", "user_id", "role", "reason", "revoked_by", "revoked_at" FROM `revoked_user_roles`;--> statement-breakpoint
DROP TABLE `revoked_user_roles`;--> statement-breakpoint
ALTER TABLE `__new_revoked_user_roles` RENAME TO `revoked_user_roles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `revoked_user_roles_unique` ON `revoked_user_roles` (`user_id`,`role`);--> statement-breakpoint
CREATE INDEX `revoked_user_roles_user_idx` ON `revoked_user_roles` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_roles_role_check" CHECK("__new_user_roles"."role" IN ('admin','cfd_worker','clinician','validator'))
);
--> statement-breakpoint
INSERT INTO `__new_user_roles`("id", "user_id", "role", "created_at") SELECT "id", "user_id", "role", "created_at" FROM `user_roles`;--> statement-breakpoint
DROP TABLE `user_roles`;--> statement-breakpoint
ALTER TABLE `__new_user_roles` RENAME TO `user_roles`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_unique` ON `user_roles` (`user_id`,`role`);