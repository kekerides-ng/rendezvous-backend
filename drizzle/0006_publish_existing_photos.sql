-- Custom SQL migration file, put your code below! --
-- Manual photo review was removed. Previously submitted photos are available
-- under the same technical file checks that new uploads must pass.
UPDATE "media"."assets"
SET "status" = 'available',
    "reason" = NULL,
    "reviewed_by" = NULL,
    "reviewed_at" = NULL,
    "updated_at" = now()
WHERE "status" IN ('pending_review', 'rejected', 'approved');
