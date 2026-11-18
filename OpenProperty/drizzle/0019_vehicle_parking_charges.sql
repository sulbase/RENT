ALTER TABLE "leases" ADD COLUMN "vehicle_monthly_fee" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_vehicle_monthly_fee" CHECK ("leases"."vehicle_monthly_fee" >= 0);
--> statement-breakpoint
ALTER TABLE "rent_charges" ADD COLUMN "kind" text DEFAULT 'rent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_kind" CHECK ("rent_charges"."kind" in ('rent', 'parking'));
--> statement-breakpoint
DROP INDEX "idx_charges_lease_period";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_charges_lease_period_kind" ON "rent_charges" USING btree ("lease_id","period","kind");
