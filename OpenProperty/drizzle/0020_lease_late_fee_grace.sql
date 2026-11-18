ALTER TABLE "leases" ADD COLUMN "late_fee_grace_days" integer;
--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_late_fee_grace_days" CHECK ("leases"."late_fee_grace_days" IS NULL OR "leases"."late_fee_grace_days" BETWEEN 1 AND 5);
