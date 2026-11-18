ALTER TABLE "tenant_emergency_contacts" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
