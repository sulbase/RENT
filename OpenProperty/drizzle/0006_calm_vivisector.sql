CREATE TYPE "public"."signature_purpose" AS ENUM('lease', 'inventory');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'inventory' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'signed_inventory' BEFORE 'other';--> statement-breakpoint
DROP INDEX "uq_lease_signatures_open";--> statement-breakpoint
ALTER TABLE "lease_signatures" ADD COLUMN "purpose" "signature_purpose" DEFAULT 'lease' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lease_signatures_open" ON "lease_signatures" USING btree ("organization_id","lease_id","purpose") WHERE "lease_signatures"."status" IN ('draft', 'sent', 'viewed', 'partially_signed');