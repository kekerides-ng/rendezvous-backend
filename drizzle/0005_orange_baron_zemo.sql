CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "media"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "media_user_created_idx" ON "media"."assets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_status_created_idx" ON "media"."assets" USING btree ("status","created_at");