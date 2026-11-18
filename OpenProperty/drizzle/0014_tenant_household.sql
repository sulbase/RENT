CREATE TABLE "tenant_emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"has_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_emergency_contacts_name_len" CHECK (char_length("tenant_emergency_contacts"."name") BETWEEN 1 AND 80),
	CONSTRAINT "tenant_emergency_contacts_relationship_len" CHECK (char_length("tenant_emergency_contacts"."relationship") BETWEEN 1 AND 80),
	CONSTRAINT "tenant_emergency_contacts_phone_len" CHECK (char_length("tenant_emergency_contacts"."phone") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "tenant_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"year" integer NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"vehicle_type" text NOT NULL,
	"plate_state" text NOT NULL,
	"license_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_vehicles_year" CHECK ("tenant_vehicles"."year" BETWEEN 1980 AND 2100),
	CONSTRAINT "tenant_vehicles_type_len" CHECK (char_length("tenant_vehicles"."vehicle_type") BETWEEN 1 AND 40),
	CONSTRAINT "tenant_vehicles_plate_state_len" CHECK (char_length("tenant_vehicles"."plate_state") BETWEEN 1 AND 40),
	CONSTRAINT "tenant_vehicles_license_len" CHECK (char_length("tenant_vehicles"."license_number") BETWEEN 1 AND 20)
);
--> statement-breakpoint
ALTER TABLE "tenant_emergency_contacts" ADD CONSTRAINT "tenant_emergency_contacts_tenant_id_organization_id_tenants_id_organization_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."tenants"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_tenant_id_organization_id_tenants_id_organization_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."tenants"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_lease_id_organization_id_leases_id_organization_id_fk" FOREIGN KEY ("lease_id","organization_id") REFERENCES "public"."leases"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_tenant_emergency_contacts_tenant" ON "tenant_emergency_contacts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_emergency_contacts_id_org" ON "tenant_emergency_contacts" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "idx_tenant_vehicles_lease" ON "tenant_vehicles" USING btree ("lease_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_vehicles_id_org" ON "tenant_vehicles" USING btree ("id","organization_id");
