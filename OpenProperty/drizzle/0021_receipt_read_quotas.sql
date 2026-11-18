CREATE TABLE "receipt_read_quotas" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_read_quotas_organization_id_unit_id_period_pk" PRIMARY KEY("organization_id","unit_id","period"),
	CONSTRAINT "receipt_read_quotas_period" CHECK ("period" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "receipt_read_quotas_calls" CHECK ("calls" BETWEEN 0 AND 5)
);
--> statement-breakpoint
ALTER TABLE "receipt_read_quotas" ADD CONSTRAINT "receipt_read_quotas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_read_quotas" ADD CONSTRAINT "receipt_read_quotas_unit_id_organization_id_units_id_organization_id_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."units"("id","organization_id") ON DELETE cascade ON UPDATE no action;
