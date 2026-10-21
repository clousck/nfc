ALTER TABLE `businesses` ADD `report_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_report_token_unique` ON `businesses` (`report_token`);