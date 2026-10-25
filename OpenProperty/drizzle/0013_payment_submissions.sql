CREATE TYPE "public"."payment_submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_entity_type" ADD VALUE 'payment_submission';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'payment_receipt' BEFORE 'system';--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"document_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text,
	"note" text,
	"status" "payment_submission_status" DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_submissions_amount" CHECK ("payment_submissions"."amount" > 0),
	CONSTRAINT "payment_submissions_reference_len" CHECK ("payment_submissions"."reference" IS NULL OR char_length("payment_submissions"."reference") BETWEEN 1 AND 120),
	CONSTRAINT "payment_submissions_note_len" CHECK ("payment_submissions"."note" IS NULL OR char_length("payment_submissions"."note") BETWEEN 1 AND 500),
	CONSTRAINT "payment_submissions_review" CHECK ((
        ("payment_submissions"."status" = 'pending' AND "payment_submissions"."reviewed_at" IS NULL AND "payment_submissions"."rejection_reason" IS NULL)
        OR ("payment_submissions"."status" = 'approved' AND "payment_submissions"."reviewed_at" IS NOT NULL AND "payment_submissions"."rejection_reason" IS NULL)
        OR ("payment_submissions"."status" = 'rejected' AND "payment_submissions"."reviewed_at" IS NOT NULL
            AND char_length("payment_submissions"."rejection_reason") BETWEEN 1 AND 200)
      ))
);
--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_tenant_id_organization_id_tenants_id_organization_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."tenants"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_charge_id_organization_id_rent_charges_id_organization_id_fk" FOREIGN KEY ("charge_id","organization_id") REFERENCES "public"."rent_charges"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_submissions_org_status" ON "payment_submissions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_payment_submissions_tenant" ON "payment_submissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payment_submissions_charge" ON "payment_submissions" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "idx_payment_submissions_document" ON "payment_submissions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_payment_submissions_payment" ON "payment_submissions" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_submissions_id_org" ON "payment_submissions" USING btree ("id","organization_id");