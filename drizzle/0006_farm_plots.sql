CREATE TABLE `farm_plots` (
	`id` text PRIMARY KEY NOT NULL,
	`farm_id` text NOT NULL,
	`name` text NOT NULL,
	`area_units` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`farm_id`) REFERENCES `farms`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plot_area_positive" CHECK("farm_plots"."area_units">0 AND "farm_plots"."area_units"<=999999999999999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plots_farm_name` ON `farm_plots` (`farm_id`,`name`);