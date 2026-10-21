CREATE TABLE `tag_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`last` integer NOT NULL,
	CONSTRAINT "tag_counter_single_row" CHECK("tag_counter"."id" = 1)
);
--> statement-breakpoint
-- SQLite no permite añadir una columna NOT NULL sin valor por defecto a una tabla con
-- filas: se reconstruye `tags` numerando los chips existentes por orden de creación.
CREATE TABLE `__new_tags` (
	`slug` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`business_id` text,
	`label` text,
	`type` text NOT NULL,
	`target_url` text,
	`active` integer DEFAULT 1 NOT NULL,
	`locked_at` integer,
	`synced_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tags` (`slug`, `number`, `business_id`, `label`, `type`, `target_url`, `active`, `locked_at`, `synced_at`, `created_at`)
SELECT `slug`, ROW_NUMBER() OVER (ORDER BY `created_at`, `slug`), `business_id`, `label`, `type`, `target_url`, `active`, `locked_at`, `synced_at`, `created_at`
FROM `tags`;
--> statement-breakpoint
DROP TABLE `tags`;
--> statement-breakpoint
ALTER TABLE `__new_tags` RENAME TO `tags`;
--> statement-breakpoint
CREATE INDEX `idx_tags_business_id` ON `tags` (`business_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_number` ON `tags` (`number`);
--> statement-breakpoint
INSERT INTO `tag_counter` (`id`, `last`) SELECT 1, COALESCE(MAX(`number`), 0) FROM `tags`;
