ALTER TABLE "documents" DROP CONSTRAINT "documents_size_bytes";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_label_len" CHECK (("documents"."label" IS NULL OR char_length("documents"."label") BETWEEN 1 AND 40));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_label_kind" CHECK (("documents"."label" IS NULL OR "documents"."kind" = 'other'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_bytes" CHECK (("documents"."size_bytes" > 0 AND "documents"."size_bytes" <= 15728640));