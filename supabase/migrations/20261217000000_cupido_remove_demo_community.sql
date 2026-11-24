BEGIN;

-- These relations were created exclusively for the demo community. Remove only
-- those isolated tables and their feed view; real profiles, posts and wallets
-- are not referenced by this schema.
DROP VIEW IF EXISTS public.cupido_demo_public_feed;
DROP TABLE IF EXISTS public.cupido_demo_post_comments;
DROP TABLE IF EXISTS public.cupido_demo_post_likes;
DROP TABLE IF EXISTS public.cupido_demo_posts;
DROP TABLE IF EXISTS public.cupido_demo_profiles;

NOTIFY pgrst, 'reload schema';
COMMIT;
