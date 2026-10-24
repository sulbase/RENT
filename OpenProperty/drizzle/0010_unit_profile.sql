ALTER TABLE "units" ADD COLUMN "floor" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "unit_type" text DEFAULT 'departamento' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "furnished" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "aliquot_price" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_floor" CHECK ("units"."floor" IS NULL OR "units"."floor" BETWEEN -5 AND 200);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_unit_type_len" CHECK (char_length("units"."unit_type") BETWEEN 1 AND 40);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_aliquot_price" CHECK ("units"."aliquot_price" >= 0);