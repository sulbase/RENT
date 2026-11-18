ALTER TABLE "payment_submissions" ADD COLUMN "fill_source" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_fill_source" CHECK ("fill_source" IN ('manual', 'automatic'));
