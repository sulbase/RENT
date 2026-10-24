ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
CREATE INDEX "idx_payments_active_charge" ON "payments" USING btree ("organization_id","charge_id") WHERE "payments"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_pair" CHECK ((
        "payments"."voided_at" IS NULL AND "payments"."void_reason" IS NULL
      ) OR (
        "payments"."voided_at" IS NOT NULL
        AND "payments"."void_reason" IS NOT NULL
        AND char_length("payments"."void_reason") BETWEEN 1 AND 200
      ));