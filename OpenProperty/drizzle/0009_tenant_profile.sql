CREATE TYPE "public"."marital_status" AS ENUM('soltero', 'casado', 'divorciado', 'viudo', 'union_libre', 'separado');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "government_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "marital_status" "marital_status";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "work_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "previous_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "occupant_count" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_government_id_len" CHECK ("tenants"."government_id" IS NULL OR char_length("tenants"."government_id") BETWEEN 1 AND 18);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_occupation_len" CHECK ("tenants"."occupation" IS NULL OR char_length("tenants"."occupation") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_work_address_len" CHECK ("tenants"."work_address" IS NULL OR char_length("tenants"."work_address") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_previous_address_len" CHECK ("tenants"."previous_address" IS NULL OR char_length("tenants"."previous_address") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_occupant_count" CHECK ("tenants"."occupant_count" IS NULL OR "tenants"."occupant_count" BETWEEN 0 AND 99);