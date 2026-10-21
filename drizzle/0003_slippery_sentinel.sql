CREATE SCHEMA "kyc";
--> statement-breakpoint
CREATE TABLE "kyc"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"reason" text,
	"adult" boolean DEFAULT false NOT NULL,
	"provider_approved" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_user_key" ON "kyc"."verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_provider_job_key" ON "kyc"."verifications" USING btree ("provider_job_id");--> statement-breakpoint
CREATE INDEX "kyc_status_created_idx" ON "kyc"."verifications" USING btree ("status","created_at");