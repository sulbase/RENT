CREATE TABLE "tenant_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "tenant_invitations_email_len" CHECK (char_length("tenant_invitations"."email") BETWEEN 3 AND 254),
	CONSTRAINT "tenant_invitations_email_lower" CHECK ("tenant_invitations"."email" = lower("tenant_invitations"."email"))
);
--> statement-breakpoint
ALTER TABLE "message_thread_participants" DROP CONSTRAINT "message_participants_kind";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_organization_id_tenants_id_organization_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."tenants"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenant_invitations_org" ON "tenant_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_invitations_tenant" ON "tenant_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_invitations_pending_tenant" ON "tenant_invitations" USING btree ("tenant_id") WHERE "tenant_invitations"."accepted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_invitations_pending_email" ON "tenant_invitations" USING btree ("email") WHERE "tenant_invitations"."accepted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenants_user" ON "tenants" USING btree ("user_id") WHERE "tenants"."user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_participants_kind" CHECK ((
        ("message_thread_participants"."participant_kind" = 'membership' AND "message_thread_participants"."user_id" IS NOT NULL AND "message_thread_participants"."tenant_id" IS NULL)
        OR ("message_thread_participants"."participant_kind" = 'tenant' AND "message_thread_participants"."tenant_id" IS NOT NULL)
      ));