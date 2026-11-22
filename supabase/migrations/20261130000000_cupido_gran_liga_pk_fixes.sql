BEGIN;

-- Gran Liga is a paid entitlement. Purchased coins remain in the credit ledger;
-- cupido_balances is reserved for withdrawable USD earned by creators.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_gran_liga BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS is_gran_liga BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.cupido_guard_paid_entitlements()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF ((TG_OP = 'INSERT' AND NEW.is_gran_liga)
      OR (TG_OP = 'UPDATE' AND NEW.is_gran_liga IS DISTINCT FROM OLD.is_gran_liga))
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'PAID_ENTITLEMENT_SERVER_ONLY';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_guard_profile_gran_liga ON public.profiles;
CREATE TRIGGER cupido_guard_profile_gran_liga BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_guard_paid_entitlements();
DROP TRIGGER IF EXISTS cupido_guard_creator_gran_liga ON public.creator_profiles;
CREATE TRIGGER cupido_guard_creator_gran_liga BEFORE INSERT OR UPDATE ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_guard_paid_entitlements();

CREATE OR REPLACE FUNCTION public.cupido_guard_post_promotion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.is_promoted IS DISTINCT FROM OLD.is_promoted
     AND current_setting('cupido.promoting_post', TRUE) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'PROMOTION_RPC_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_guard_post_promotion ON public.cupido_posts;
CREATE TRIGGER cupido_guard_post_promotion BEFORE UPDATE OF is_promoted ON public.cupido_posts
FOR EACH ROW EXECUTE FUNCTION public.cupido_guard_post_promotion();

CREATE OR REPLACE VIEW public.cupido_public_profiles
WITH (security_barrier = TRUE)
AS
SELECT
  cp.id, cp.display_name, cp.avatar_url, cp.bio, cp.country_code, cp.age, cp.gender,
  cp.looking_for, cp.zodiac, cp.smokes, cp.drinks, cp.has_kids, cp.hobbies,
  cp.survey_completed, cp.is_verified_blue, cp.is_super_admin, cp.is_official,
  cp.is_cupido_active, cp.is_premium, cp.friend_count, cp.follower_count,
  cp.created_at, cp.hide_followers, cp.verification_status, cp.interested_count,
  cp.is_gran_liga
FROM public.creator_profiles AS cp;
GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

-- A captured PayPal order and its credit grant commit together, so retries cannot
-- charge twice or leave a captured order without its coins and entitlement.
CREATE OR REPLACE FUNCTION public.cupido_finalize_paypal_package(
  _order_id UUID,
  _user_id UUID,
  _credits INTEGER,
  _gran_liga BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.paypal_orders%ROWTYPE;
  resulting_balance INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT * INTO order_row
  FROM public.paypal_orders
  WHERE id = _order_id AND user_id = _user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100' OR order_row.amount::NUMERIC <> 100 OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN
    RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH';
  END IF;
  IF order_row.status = 'captured' THEN RETURN TRUE; END IF;
  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;

  PERFORM public.grant_credits(_user_id => _user_id, _amount => _credits,
    _reason => 'Compra PayPal ' || _credits || ' monedas');
  SELECT balance INTO resulting_balance
  FROM public.user_credits
  WHERE user_id = _user_id;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;

  UPDATE public.profiles
  SET credits = resulting_balance,
      credits_balance = resulting_balance,
      has_purchased = TRUE,
      is_gran_liga = is_gran_liga OR _gran_liga
  WHERE id = _user_id;
  UPDATE public.creator_profiles
  SET is_gran_liga = is_gran_liga OR _gran_liga
  WHERE id = _user_id;
  UPDATE public.paypal_orders
  SET status = 'captured', captured_at = now()
  WHERE id = _order_id AND status = 'created';

  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN) TO service_role;

-- Catalog prices are server authoritative. The client-supplied amount fields are
-- intentionally ignored; only the catalog's values can spend coins or pay out USD.
INSERT INTO public.cupido_gifts (id, name, emoji, credits, cash, sort_order)
VALUES ('gran-liga-diamond', 'Diamante Gran Liga', '💎', 1000000, 60.00, 100)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, emoji = EXCLUDED.emoji,
    credits = EXCLUDED.credits, cash = EXCLUDED.cash, sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver UUID, _gift_id TEXT, _room UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender UUID := auth.uid();
  gift public.cupido_gifts%ROWTYPE;
  send_id UUID;
  is_admin BOOLEAN;
  is_gran_liga BOOLEAN;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;

  SELECT * INTO gift FROM public.cupido_gifts
  WHERE id = _gift_id AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
    OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms
    WHERE id = _room AND host_id = _receiver AND is_live
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  is_admin := public.has_role(sender, 'admin') OR public.has_role(sender, 'admin_supremo');
  SELECT COALESCE(cp.is_gran_liga, FALSE) INTO is_gran_liga
  FROM public.creator_profiles cp WHERE cp.id = sender;
  IF gift.id = 'gran-liga-diamond' AND NOT COALESCE(is_gran_liga, FALSE) AND NOT is_admin THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF gift.credits > 500 AND NOT is_admin
     AND NOT COALESCE(is_gran_liga, FALSE)
     AND NOT EXISTS (SELECT 1 FROM public.paypal_orders WHERE user_id = sender AND status = 'captured') THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;

  PERFORM public.consume_credits(gift.credits, 'Regalo Cupido: ' || gift.name);
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash)
  RETURNING id INTO send_id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = EXCLUDED.updated_at;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond' THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.' END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC, _room UUID
)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) TO authenticated;

-- Real groups and friend invitations. Privileged operations are RPC-only.
CREATE TABLE IF NOT EXISTS public.cupido_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cupido_group_members (
  group_id UUID NOT NULL REFERENCES public.cupido_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.cupido_groups(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, invitee_id)
);
ALTER TABLE public.cupido_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_group_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_groups_member_read ON public.cupido_groups;
CREATE POLICY cupido_groups_member_read ON public.cupido_groups FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.cupido_group_members m WHERE m.group_id = id AND m.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.cupido_group_invites i WHERE i.group_id = id AND i.invitee_id = auth.uid()
  ));
DROP POLICY IF EXISTS cupido_group_members_read ON public.cupido_group_members;
CREATE POLICY cupido_group_members_read ON public.cupido_group_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS cupido_group_invites_participant_read ON public.cupido_group_invites;
CREATE POLICY cupido_group_invites_participant_read ON public.cupido_group_invites FOR SELECT TO authenticated
  USING (inviter_id = auth.uid() OR invitee_id = auth.uid());
REVOKE ALL ON public.cupido_groups, public.cupido_group_members, public.cupido_group_invites FROM anon, authenticated;
GRANT SELECT ON public.cupido_groups, public.cupido_group_members, public.cupido_group_invites TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_create_group(_name TEXT, _description TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); group_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = actor AND is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  INSERT INTO public.cupido_groups (owner_id, name, description)
  VALUES (actor, btrim(_name), COALESCE(btrim(_description), '')) RETURNING id INTO group_uuid;
  INSERT INTO public.cupido_group_members (group_id, user_id, role) VALUES (group_uuid, actor, 'owner');
  RETURN group_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_invite_group_friend(_group UUID, _invitee UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); invite_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_groups WHERE id = _group AND owner_id = actor) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;
  IF actor = _invitee OR NOT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = actor AND f.addressee_id = _invitee)
        OR (f.requester_id = _invitee AND f.addressee_id = actor))
  ) THEN RAISE EXCEPTION 'FRIENDS_ONLY'; END IF;
  INSERT INTO public.cupido_group_invites (group_id, inviter_id, invitee_id)
  VALUES (_group, actor, _invitee)
  ON CONFLICT (group_id, invitee_id) DO UPDATE SET inviter_id = EXCLUDED.inviter_id,
    status = 'pending', created_at = now()
  RETURNING id INTO invite_uuid;
  RETURN invite_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_respond_group_invite(_invite UUID, _accept BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); invite_row public.cupido_group_invites%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO invite_row FROM public.cupido_group_invites WHERE id = _invite AND invitee_id = actor FOR UPDATE;
  IF NOT FOUND OR invite_row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  UPDATE public.cupido_group_invites SET status = CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END WHERE id = _invite;
  IF _accept THEN
    INSERT INTO public.cupido_group_members (group_id, user_id) VALUES (invite_row.group_id, actor)
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_create_group(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_invite_group_friend(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_respond_group_invite(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_create_group(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_invite_group_friend(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_respond_group_invite(UUID, BOOLEAN) TO authenticated;

-- Promoting a post costs 500 coins and can only be triggered by its author.
CREATE OR REPLACE FUNCTION public.cupido_promote_post(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = actor AND is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  PERFORM 1 FROM public.cupido_posts WHERE id = _post AND user_id = actor AND NOT is_promoted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;
  PERFORM public.consume_credits(500, 'Promoción de publicación en el muro');
  PERFORM set_config('cupido.promoting_post', 'true', TRUE);
  UPDATE public.cupido_posts SET is_promoted = TRUE WHERE id = _post;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_promote_post(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_promote_post(UUID) TO authenticated;

-- PK requests expire after ten seconds and both creation and decisions are verified server-side.
CREATE TABLE IF NOT EXISTS public.cupido_pk_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 seconds'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  CHECK (host_id <> requester_id)
);
CREATE INDEX IF NOT EXISTS cupido_pk_requests_host_pending_idx
  ON public.cupido_pk_requests (host_id, expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS cupido_pk_requests_one_active_per_room_idx
  ON public.cupido_pk_requests (room_id) WHERE status IN ('pending', 'accepted');
ALTER TABLE public.cupido_pk_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_pk_requests_participant_read ON public.cupido_pk_requests;
CREATE POLICY cupido_pk_requests_participant_read ON public.cupido_pk_requests FOR SELECT TO authenticated
  USING (host_id = auth.uid() OR requester_id = auth.uid());
REVOKE ALL ON public.cupido_pk_requests FROM anon, authenticated;
GRANT SELECT ON public.cupido_pk_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_request_pk(_room UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); room_row public.cupido_live_rooms%ROWTYPE; request_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = actor AND (is_verified_blue OR is_gran_liga)) THEN
    RAISE EXCEPTION 'BADGE_REQUIRED';
  END IF;
  SELECT * INTO room_row FROM public.cupido_live_rooms WHERE id = _room AND is_live FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  IF room_row.host_id = actor THEN RAISE EXCEPTION 'PK_SELF_REQUEST'; END IF;
  UPDATE public.cupido_pk_requests SET status = 'expired', answered_at = now()
  WHERE room_id = _room AND status = 'pending' AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM public.cupido_pk_requests
    WHERE room_id = _room AND status IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'PK_BATTLE_ACTIVE';
  END IF;
  INSERT INTO public.cupido_pk_requests (room_id, host_id, requester_id, expires_at)
  VALUES (_room, room_row.host_id, actor, now() + INTERVAL '10 seconds') RETURNING id INTO request_uuid;
  RETURN request_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_respond_pk(_request UUID, _accept BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); request_row public.cupido_pk_requests%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO request_row FROM public.cupido_pk_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR request_row.host_id <> actor THEN RAISE EXCEPTION 'NOT_PK_HOST'; END IF;
  IF request_row.status <> 'pending' THEN RETURN request_row.status; END IF;
  IF request_row.expires_at <= now() THEN
    UPDATE public.cupido_pk_requests SET status = 'expired', answered_at = now() WHERE id = _request;
    RETURN 'expired';
  END IF;
  UPDATE public.cupido_pk_requests
  SET status = CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END, answered_at = now()
  WHERE id = _request;
  RETURN CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_request_pk(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_respond_pk(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_request_pk(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_respond_pk(UUID, BOOLEAN) TO authenticated;

-- Blue and Gran Liga accounts may host free or premium Lives.
CREATE OR REPLACE FUNCTION public.cupido_start_live_room(_title TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = auth.uid()
    AND (cp.is_verified_blue OR cp.is_gran_liga OR cp.is_official OR cp.is_super_admin))
    AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'NOT_VERIFIED'; END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title)
  VALUES (auth.uid(), COALESCE(NULLIF(BTRIM(_title), ''), 'Live de Cupido Leudy ❤️'))
  RETURNING id INTO room_id;
  RETURN room_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_room(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_premium_live(_title TEXT, _coins INTEGER, _minutes INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_uuid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF (_coins, _minutes) NOT IN ((150, 15), (300, 30), (500, 45), (1000, 60)) THEN RAISE EXCEPTION 'INVALID_LIVE_TIER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = auth.uid()
      AND (cp.is_verified_blue OR cp.is_gran_liga OR cp.is_official OR cp.is_super_admin))
     AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'NOT_VERIFIED'; END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title, premium_coins, premium_minutes, premium_ends_at)
  VALUES (auth.uid(), COALESCE(NULLIF(btrim(_title), ''), 'Live Premium'), _coins, _minutes, now() + make_interval(mins => _minutes))
  RETURNING id INTO room_uuid;
  RETURN room_uuid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) TO authenticated;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cupido_pk_requests', 'cupido_groups', 'cupido_group_members', 'cupido_group_invites'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
