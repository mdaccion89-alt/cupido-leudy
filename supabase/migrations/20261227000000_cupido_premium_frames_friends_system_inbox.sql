BEGIN;

-- Real-money credit provenance is tracked separately so welcome/ad credits
-- can never be used to acquire avatar frames. The withdrawable USD ledger is untouched.
ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS purchased_credit_balance integer NOT NULL DEFAULT 0;

-- Conservative one-time backfill: count captured paid credits, subtract all
-- recorded spends and the still-known welcome/ad credits. This can under-credit
-- legacy accounts, but cannot make promotional credits frame-purchasable.
WITH paid AS (
  SELECT user_id, sum(credits)::bigint AS total
  FROM public.paypal_orders
  WHERE status = 'captured'
  GROUP BY user_id
), spent AS (
  SELECT user_id, greatest(-sum(least(delta, 0)), 0)::bigint AS total
  FROM public.credit_transactions
  GROUP BY user_id
)
UPDATE public.user_credits c
SET purchased_credit_balance = greatest(
      0,
      coalesce(p.total, 0)
      - coalesce(s.total, 0)
      - coalesce(c.ad_reward_balance, 0)
      - CASE WHEN coalesce(pf.has_purchased, false) THEN 500 ELSE 0 END
    )::integer
FROM public.profiles pf
LEFT JOIN paid p ON p.user_id = pf.id
LEFT JOIN spent s ON s.user_id = pf.id
WHERE c.user_id = pf.id
  AND c.purchased_credit_balance = 0
  AND coalesce(p.total, 0) > 0;

CREATE TABLE IF NOT EXISTS public.cupido_avatar_frames (
  id text PRIMARY KEY,
  level integer NOT NULL UNIQUE CHECK (level BETWEEN 1 AND 59),
  name text NOT NULL,
  coin_cost integer NOT NULL CHECK (coin_cost > 0),
  color_a text NOT NULL,
  color_b text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('orbit','shine','water','fire','wings','galaxy','diamond')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cupido_avatar_frames (id, level, name, coin_cost, color_a, color_b, effect)
SELECT 'frame-' || lpad(level::text, 2, '0'), level, name,
       99 + (level - 1) * 100,
       (ARRAY['#f9a8d4','#fbbf24','#67e8f9','#fb7185','#c4b5fd','#34d399','#e2e8f0'])[((level - 1) % 7) + 1],
       (ARRAY['#be185d','#f97316','#2563eb','#7c3aed','#0f766e','#db2777','#0ea5e9'])[((level + 2) % 7) + 1],
       (ARRAY['orbit','shine','water','fire','wings','galaxy','diamond'])[((level - 1) % 7) + 1]
FROM unnest(ARRAY[
  'Novato Rosa','Destello Inicial','Corazón Brillante','Aro de Rubí','Perla de Luna',
  'Oro Rosado','Loto Celeste','Chispa Violeta','Aurora Tropical','Jardín de Cristal',
  'Corona de Fuego','Olas Turquesa','Alas de Amor','Diamante Rosa','Nébula Real',
  'Reina del Caribe','Rey del Caribe','Lluvia de Estrellas','Doble Corazón','Prisma Dorado',
  'Fénix Carmesí','Sirena Azul','Cometa de Plata','Joya Esmeralda','Mariposa Celeste',
  'Galaxia de Amor','Corona Imperial','Dragón de Rubí','Oro Líquido','Flor de Medianoche',
  'Alas Celestiales','Fuego Sagrado','Aqua Reina','Diamante Azul','Sol de Gran Liga',
  'Luna de Gran Liga','Emperatriz Dorada','Emperador de Cristal','Fénix Legendario','Dragón Imperial',
  'Tormenta Neón','Océano Místico','Aurora Boreal','Corona de Zafiro','Galaxia Suprema',
  'Alas del Paraíso','Llama Infinita','Reina de Diamantes','Rey de Diamantes','Diosa del Amor',
  'Titán Dorado','Dragón Celestial','Prisma Infinito','Fénix de Platino','Soberano Cósmico',
  'Corazón Eterno','Leyenda de Cristal','Diosa Suprema','Leyenda Suprema Pro'
]::text[]) WITH ORDINALITY AS frames(name, level)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cupido_user_avatar_frames (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  frame_id text NOT NULL REFERENCES public.cupido_avatar_frames(id) ON DELETE CASCADE,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  paid_credits integer NOT NULL CHECK (paid_credits > 0),
  PRIMARY KEY (user_id, frame_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_equipped_avatar_frames (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  frame_id text NOT NULL REFERENCES public.cupido_avatar_frames(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cupido_avatar_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_user_avatar_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_equipped_avatar_frames ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_avatar_frames_public_read ON public.cupido_avatar_frames;
CREATE POLICY cupido_avatar_frames_public_read ON public.cupido_avatar_frames
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS cupido_user_avatar_frames_owner_read ON public.cupido_user_avatar_frames;
CREATE POLICY cupido_user_avatar_frames_owner_read ON public.cupido_user_avatar_frames
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS cupido_equipped_avatar_frames_public_read ON public.cupido_equipped_avatar_frames;
CREATE POLICY cupido_equipped_avatar_frames_public_read ON public.cupido_equipped_avatar_frames
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.cupido_avatar_frames,
  public.cupido_user_avatar_frames, public.cupido_equipped_avatar_frames FROM anon, authenticated;
GRANT SELECT ON public.cupido_avatar_frames, public.cupido_user_avatar_frames,
  public.cupido_equipped_avatar_frames TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_equipped_avatar_frame(_user uuid)
RETURNS TABLE(frame_id text, color_a text, color_b text, effect text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.color_a, f.color_b, f.effect
  FROM public.cupido_equipped_avatar_frames e
  JOIN public.cupido_avatar_frames f ON f.id = e.frame_id
  WHERE e.user_id = _user
$$;
REVOKE ALL ON FUNCTION public.cupido_get_equipped_avatar_frame(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupido_get_equipped_avatar_frame(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_purchase_avatar_frame(_frame_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); frame_row public.cupido_avatar_frames%ROWTYPE; new_balance integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO frame_row FROM public.cupido_avatar_frames WHERE id = _frame_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FRAME_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.paypal_orders o ON o.user_id = p.id AND o.status = 'captured'
    WHERE p.id = actor AND p.has_purchased = true
  ) THEN RAISE EXCEPTION 'REAL_PURCHASE_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_user_avatar_frames WHERE user_id = actor AND frame_id = _frame_id) THEN
    RETURN (SELECT balance FROM public.user_credits WHERE user_id = actor);
  END IF;
  UPDATE public.user_credits
     SET balance = balance - frame_row.coin_cost,
         purchased_credit_balance = purchased_credit_balance - frame_row.coin_cost,
         updated_at = now()
   WHERE user_id = actor AND balance >= frame_row.coin_cost
     AND purchased_credit_balance >= frame_row.coin_cost
   RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_PURCHASED_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (actor, -frame_row.coin_cost, 'Marco de avatar Cupido: ' || frame_row.name);
  INSERT INTO public.cupido_user_avatar_frames (user_id, frame_id, paid_credits)
  VALUES (actor, _frame_id, frame_row.coin_cost);
  RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_purchase_avatar_frame(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_purchase_avatar_frame(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_equip_avatar_frame(_frame_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _frame_id IS NULL THEN
    DELETE FROM public.cupido_equipped_avatar_frames WHERE user_id = actor;
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_user_avatar_frames WHERE user_id = actor AND frame_id = _frame_id) THEN
    RAISE EXCEPTION 'FRAME_NOT_OWNED';
  END IF;
  INSERT INTO public.cupido_equipped_avatar_frames (user_id, frame_id, updated_at)
  VALUES (actor, _frame_id, now())
  ON CONFLICT (user_id) DO UPDATE SET frame_id = EXCLUDED.frame_id, updated_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_equip_avatar_frame(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_equip_avatar_frame(text) TO authenticated;

-- System onboarding is stored outside cupido_conversations/cupido_messages.
CREATE TABLE IF NOT EXISTS public.cupido_system_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'welcome',
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);
ALTER TABLE public.cupido_system_inbox_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_system_inbox_owner_read ON public.cupido_system_inbox_messages;
CREATE POLICY cupido_system_inbox_owner_read ON public.cupido_system_inbox_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.cupido_system_inbox_messages FROM anon, authenticated;
GRANT SELECT ON public.cupido_system_inbox_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_create_welcome_inbox_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.cupido_system_inbox_messages (user_id, kind, title, body)
  VALUES (
    NEW.id,
    'welcome',
    '¡Bienvenido a Cupido Leudy! ❤️',
    'Tus 500 monedas de bienvenida están listas para empezar. Guía rápida: haz una recarga real para activar el envío de regalos; entra a En Directo para iniciar un Live; completa tu perfil y solicita la Insignia Azul con tu selfie; y consulta Cupido Studio para retirar las ganancias reales recibidas. Las monedas y bonos sirven para regalos; solo las ganancias reales aparecen en tu saldo retirable.'
  )
  ON CONFLICT (user_id, kind) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_auth_welcome_inbox ON auth.users;
CREATE TRIGGER cupido_auth_welcome_inbox
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.cupido_create_welcome_inbox_message();
REVOKE ALL ON FUNCTION public.cupido_create_welcome_inbox_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_friend_count(_user uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT friend_id)::bigint
  FROM (
    SELECT CASE WHEN f.requester_id = _user THEN f.addressee_id ELSE f.requester_id END AS friend_id
    FROM public.friend_requests f
    WHERE f.status = 'accepted' AND _user IN (f.requester_id, f.addressee_id)
    UNION
    SELECT outgoing.following_id
    FROM public.follows outgoing
    JOIN public.follows incoming
      ON incoming.follower_id = outgoing.following_id
     AND incoming.following_id = outgoing.follower_id
    WHERE outgoing.follower_id = _user
  ) friends
$$;
REVOKE ALL ON FUNCTION public.cupido_get_friend_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_friend_count(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_list_friends(_user uuid)
RETURNS TABLE(friend_id uuid, display_name text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH friend_ids AS (
    SELECT CASE WHEN f.requester_id = _user THEN f.addressee_id ELSE f.requester_id END AS id
    FROM public.friend_requests f
    WHERE f.status = 'accepted' AND _user IN (f.requester_id, f.addressee_id)
    UNION
    SELECT outgoing.following_id
    FROM public.follows outgoing
    JOIN public.follows incoming
      ON incoming.follower_id = outgoing.following_id
     AND incoming.following_id = outgoing.follower_id
    WHERE outgoing.follower_id = _user
  )
  SELECT friend.id, friend.display_name, friend.avatar_url
  FROM friend_ids ids
  JOIN public.creator_profiles owner ON owner.id = _user
  JOIN public.creator_profiles friend ON friend.id = ids.id
  WHERE (_user = auth.uid() OR NOT owner.hide_followers)
  ORDER BY friend.display_name
$$;
REVOKE ALL ON FUNCTION public.cupido_list_friends(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_list_friends(uuid) TO authenticated;

-- Charge the verified-purchase provenance wallet alongside existing coin spends.
CREATE OR REPLACE FUNCTION public.consume_credits(_amount integer, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN RETURN -1; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.has_recharged OR p.has_purchased)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = auth.uid() AND o.status = 'captured'
  ) THEN RAISE EXCEPTION 'PURCHASE_REQUIRED'; END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  UPDATE public.user_credits
     SET balance = balance - _amount,
         purchased_credit_balance = greatest(purchased_credit_balance - _amount, 0),
         updated_at = now()
   WHERE user_id = auth.uid() AND balance >= _amount
   RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (auth.uid(), -_amount, coalesce(nullif(btrim(_reason), ''), 'Uso de monedas'));
  RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_credits(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver uuid, _gift_id text, _room uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sender uuid := auth.uid(); sender_email text; sender_has_purchased boolean := false;
  gift public.cupido_gifts%ROWTYPE; send_id uuid; infinite_admin boolean; new_balance integer;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT lower(coalesce(u.email, '')) INTO sender_email FROM auth.users u WHERE u.id = sender;
  infinite_admin := sender_email = 'leudyfeliz81@gmail.com';
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _receiver) THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT * INTO gift FROM public.cupido_gifts
   WHERE id = _gift_id AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
     OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = _room AND r.is_live
      AND (r.host_id = _receiver OR EXISTS (
        SELECT 1 FROM public.cupido_live_pk_battles b WHERE b.room_id = _room
          AND b.challenger_id = _receiver AND b.finished_at IS NULL AND b.ends_at > now()
      ))
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  IF gift.id = 'gran-liga-diamond' AND NOT infinite_admin
     AND NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = sender AND cp.is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF NOT infinite_admin THEN
    SELECT coalesce(p.has_purchased, false) INTO sender_has_purchased FROM public.profiles p WHERE p.id = sender;
    IF NOT sender_has_purchased AND NOT EXISTS (
      SELECT 1 FROM public.user_credits c WHERE c.user_id = sender AND coalesce(c.ad_reward_balance, 0) >= gift.credits
    ) THEN RAISE EXCEPTION 'PURCHASE_REQUIRED'; END IF;
    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits
       SET balance = balance - gift.credits,
           ad_reward_balance = greatest(coalesce(ad_reward_balance, 0) - gift.credits, 0),
           purchased_credit_balance = greatest(purchased_credit_balance - gift.credits, 0),
           updated_at = now()
     WHERE user_id = sender AND balance >= gift.credits
       AND (sender_has_purchased OR coalesce(ad_reward_balance, 0) >= gift.credits)
     RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;
  INSERT INTO public.cupido_gift_sends (
    sender_id, sender_user_id, from_user_id, receiver_id, recipient_id, to_user_id,
    gift_id, gift_name, credits, coin_cost, coins, cash_value, live_room_id
  ) VALUES (
    sender, sender, sender, _receiver, _receiver, _receiver,
    gift.id, gift.name, gift.credits, gift.credits, gift.credits, gift.cash, _room
  ) RETURNING id INTO send_id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + EXCLUDED.balance, updated_at = now();
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond' THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
         ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.' END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_finalize_paypal_package(
  _order_id uuid, _user_id uuid, _credits integer, _gran_liga boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE order_row public.paypal_orders%ROWTYPE; resulting_balance integer; infinite_admin boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO order_row FROM public.paypal_orders WHERE id = _order_id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100' OR order_row.amount::numeric NOT IN (60, 100) OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH'; END IF;
  SELECT lower(coalesce(email, '')) = 'leudyfeliz81@gmail.com' INTO infinite_admin FROM auth.users WHERE id = _user_id;
  IF order_row.status = 'captured' THEN
    SELECT CASE WHEN coalesce(infinite_admin, false) THEN -1 ELSE coalesce(c.balance, p.credits_balance, p.credits, 0) END
      INTO resulting_balance FROM public.profiles p LEFT JOIN public.user_credits c ON c.user_id = p.id WHERE p.id = _user_id;
    UPDATE public.profiles p SET coins = coalesce(resulting_balance, p.credits_balance, p.credits, 0),
      credits = coalesce(resulting_balance, p.credits_balance, p.credits, 0),
      credits_balance = coalesce(resulting_balance, p.credits_balance, p.credits, 0),
      has_purchased = true, has_recharged = true, is_gran_liga = is_gran_liga OR _gran_liga, updated_at = now()
    WHERE p.id = _user_id;
    RETURN true;
  END IF;
  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;
  IF coalesce(infinite_admin, false) THEN
    resulting_balance := -1;
  ELSE
    PERFORM public.grant_credits(_user_id => _user_id, _amount => _credits, _reason => 'Compra PayPal ' || _credits || ' monedas');
    UPDATE public.user_credits SET purchased_credit_balance = purchased_credit_balance + _credits, updated_at = now()
    WHERE user_id = _user_id;
    SELECT balance INTO resulting_balance FROM public.user_credits WHERE user_id = _user_id;
  END IF;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;
  UPDATE public.profiles SET coins = resulting_balance, credits = resulting_balance, credits_balance = resulting_balance,
    has_purchased = true, has_recharged = true, is_gran_liga = is_gran_liga OR _gran_liga, updated_at = now()
  WHERE id = _user_id;
  UPDATE public.creator_profiles SET is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.paypal_orders SET status = 'captured', captured_at = now() WHERE id = _order_id AND status = 'created';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(uuid, uuid, integer, boolean) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_equipped_avatar_frames') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_equipped_avatar_frames;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_user_avatar_frames') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_user_avatar_frames;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_system_inbox_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_system_inbox_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'friend_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'follows') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
