CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"provider_user_id" text NOT NULL,
	"phone" text,
	"email" text,
	"kyc_verified_at" timestamp with time zone,
	"date_of_birth" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"chain_type" text DEFAULT 'ethereum' NOT NULL,
	"kind" text DEFAULT 'embedded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "auth"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_user_id_key" ON "auth"."users" USING btree ("provider_user_id");--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "auth"."users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_key" ON "auth"."wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "wallets_user_id_idx" ON "auth"."wallets" USING btree ("user_id");