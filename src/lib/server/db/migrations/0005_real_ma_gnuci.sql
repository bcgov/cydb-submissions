CREATE TABLE `revoked_user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`reason` text,
	`revoked_by` text NOT NULL,
	`revoked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revoked_user_roles_role_check" CHECK("revoked_user_roles"."role" IN ('admin','cfd_worker','clinician'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revoked_user_roles_unique` ON `revoked_user_roles` (`user_id`,`role`);--> statement-breakpoint
CREATE INDEX `revoked_user_roles_user_idx` ON `revoked_user_roles` (`user_id`);
