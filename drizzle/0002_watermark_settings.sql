CREATE TABLE `watermarks` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`orientation` text DEFAULT 'portrait' NOT NULL,
	`opacity` integer DEFAULT 15 NOT NULL,
	`size` integer DEFAULT 60 NOT NULL,
	`image_key` text,
	`image_name` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "watermark_orientation" CHECK("watermarks"."orientation" in ('portrait','landscape')),
	CONSTRAINT "watermark_opacity" CHECK("watermarks"."opacity" between 0 and 100),
	CONSTRAINT "watermark_size" CHECK("watermarks"."size" between 10 and 100)
);
