ALTER TABLE "payment_submissions" ADD COLUMN "payer_bank_name" text;
--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD COLUMN "receipt_number" text;
--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_payer_bank_len" CHECK ("payment_submissions"."payer_bank_name" IS NULL OR char_length("payment_submissions"."payer_bank_name") BETWEEN 1 AND 80);
--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_receipt_number_len" CHECK ("payment_submissions"."receipt_number" IS NULL OR char_length("payment_submissions"."receipt_number") BETWEEN 1 AND 80);
