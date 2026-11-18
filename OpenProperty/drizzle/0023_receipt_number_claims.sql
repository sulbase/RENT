CREATE TABLE "receipt_number_claims" (
	"organization_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "receipt_number_claims_organization_id_receipt_number_pk" PRIMARY KEY("organization_id","receipt_number"),
	CONSTRAINT "receipt_number_claims_len" CHECK (char_length("receipt_number") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "receipt_number_claims" ADD CONSTRAINT "receipt_number_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_number_claims" ADD CONSTRAINT "receipt_number_claims_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_receipt_number_claims_document" ON "receipt_number_claims" USING btree ("document_id");
--> statement-breakpoint
INSERT INTO "receipt_number_claims" ("organization_id", "receipt_number", "document_id")
SELECT DISTINCT ON (organization_id, receipt_number)
	organization_id, receipt_number, document_id
FROM (
	SELECT organization_id,
		lower(btrim(regexp_replace(receipt_number, '\s+', ' ', 'g'))) AS receipt_number,
		document_id,
		created_at
	FROM payment_submissions
	WHERE receipt_number IS NOT NULL
		AND btrim(receipt_number) <> ''
		AND status <> 'rejected'
		AND document_id IS NOT NULL
) taken
ORDER BY organization_id, receipt_number, created_at;
