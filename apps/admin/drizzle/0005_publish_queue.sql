CREATE TABLE `publish_queue` (
	`entity` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
