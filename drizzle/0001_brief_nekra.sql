CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE TYPE "admin"."admin_role" AS ENUM('admin', 'moderator');--> statement-breakpoint
CREATE TABLE "admin"."admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin"."admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"role" "admin"."admin_role" DEFAULT 'moderator' NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin"."admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin"."admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin"."admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_log_admin_user_id_idx" ON "admin"."audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "admin"."audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "admin"."audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "admin"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "settings_updated_by_idx" ON "admin"."settings" USING btree ("updated_by_admin_id");