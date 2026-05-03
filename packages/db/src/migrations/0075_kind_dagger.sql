DROP INDEX "company_secrets_company_name_uq";--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_secret_reads_idx" ON "activity_log" USING btree ("entity_id","created_at" DESC NULLS LAST) WHERE "activity_log"."entity_type" = 'secret' AND "activity_log"."action" = 'secret.read';--> statement-breakpoint
CREATE UNIQUE INDEX "company_secrets_company_agent_name_uq" ON "company_secrets" USING btree ("company_id",COALESCE("agent_id", '00000000-0000-0000-0000-000000000000'::uuid),"name");--> statement-breakpoint
CREATE INDEX "company_secrets_agent_idx" ON "company_secrets" USING btree ("agent_id") WHERE "company_secrets"."agent_id" IS NOT NULL;
