BEGIN;

-- A gift can only be transferred after a real purchase, except for the
-- existing infinite-credit administrator account. This server-side check is
-- atomic with the wallet debit and applies to both Chat and Live RPC callers.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_purchased BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_recharged BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(
  _receiver UUID,
  _gift_id TEXT,
  _room UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender UUID := auth.uid();
  sender_email TEXT;
  gift public.cupido_gifts%ROWTYPE;
  send_id UUID;
  infinite_admin BOOLEAN;
  new_balance INTEGER;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT lower(COALESCE(u.email, '')) INTO sender_email FROM auth.users AS u WHERE u.id = sender;
  infinite_admin := sender_email = 'leudyfeliz81@gmail.com';
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = _receiver) THEN
    RAISE EXCEPTION 'INVALID_RECEIVER';
  END IF;

  SELECT * INTO gift
  FROM public.cupido_gifts
  WHERE id = _gift_id
    AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
      OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms AS r
    WHERE r.id = _room AND r.is_live
      AND (r.host_id = _receiver OR EXISTS (
        SELECT 1 FROM public.cupido_live_pk_battles AS b
        WHERE b.room_id = _room AND b.challenger_id = _receiver
          AND b.finished_at IS NULL AND b.ends_at > now()
      ))
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  IF gift.id = 'gran-liga-diamond' AND NOT infinite_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.creator_profiles AS cp
       WHERE cp.id = sender AND cp.is_gran_liga
     ) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;

  IF NOT infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = sender AND COALESCE(p.has_purchased, FALSE)
  ) THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;

  IF NOT infinite_admin THEN
    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits
    SET balance = balance - gift.credits, updated_at = now()
    WHERE user_id = sender AND balance >= gift.credits
    RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (
    sender_id, sender_user_id, from_user_id,
    receiver_id, recipient_id, to_user_id,
    gift_id, gift_name, credits, coin_cost, coins, cash_value, live_room_id
  ) VALUES (
    sender, sender, sender,
    _receiver, _receiver, _receiver,
    gift.id, gift.name, gift.credits, gift.credits, gift.credits, gift.cash, _room
  ) RETURNING id INTO send_id;

  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (
    _receiver,
    'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond'
      THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.'
    END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END,
    sender,
    send_id
  );
  RETURN send_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;

-- Community sample content is kept outside auth.users and every money-bearing
-- table. The stable UUIDs make the seed safe to rerun without touching real users.
CREATE TABLE IF NOT EXISTS public.cupido_demo_profiles (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('woman', 'man')),
  age SMALLINT NOT NULL CHECK (age BETWEEN 18 AND 54),
  country_code TEXT NOT NULL,
  bio TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  follower_count INTEGER NOT NULL CHECK (follower_count BETWEEN 120 AND 24500),
  is_demo BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_demo = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_demo_posts (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.cupido_demo_profiles(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  caption TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_demo = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_demo_post_likes (
  post_id UUID NOT NULL REFERENCES public.cupido_demo_posts(id) ON DELETE CASCADE,
  demo_profile_id UUID NOT NULL REFERENCES public.cupido_demo_profiles(id) ON DELETE CASCADE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_demo = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, demo_profile_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_demo_post_comments (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.cupido_demo_posts(id) ON DELETE CASCADE,
  demo_profile_id UUID NOT NULL REFERENCES public.cupido_demo_profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_demo = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cupido_demo_posts_created_idx ON public.cupido_demo_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_demo_posts_profile_idx ON public.cupido_demo_posts (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_demo_comments_post_idx ON public.cupido_demo_post_comments (post_id, created_at DESC);

ALTER TABLE public.cupido_demo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_demo_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_demo_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_demo_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cupido_demo_profiles_public_read ON public.cupido_demo_profiles;
CREATE POLICY cupido_demo_profiles_public_read ON public.cupido_demo_profiles
  FOR SELECT TO anon, authenticated USING (is_demo);
DROP POLICY IF EXISTS cupido_demo_posts_public_read ON public.cupido_demo_posts;
CREATE POLICY cupido_demo_posts_public_read ON public.cupido_demo_posts
  FOR SELECT TO anon, authenticated USING (is_demo);
DROP POLICY IF EXISTS cupido_demo_likes_public_read ON public.cupido_demo_post_likes;
CREATE POLICY cupido_demo_likes_public_read ON public.cupido_demo_post_likes
  FOR SELECT TO anon, authenticated USING (is_demo);
DROP POLICY IF EXISTS cupido_demo_comments_public_read ON public.cupido_demo_post_comments;
CREATE POLICY cupido_demo_comments_public_read ON public.cupido_demo_post_comments
  FOR SELECT TO anon, authenticated USING (is_demo);

REVOKE ALL ON public.cupido_demo_profiles, public.cupido_demo_posts,
  public.cupido_demo_post_likes, public.cupido_demo_post_comments FROM anon, authenticated;
GRANT SELECT ON public.cupido_demo_profiles, public.cupido_demo_posts,
  public.cupido_demo_post_likes, public.cupido_demo_post_comments TO anon, authenticated;

DO $$
DECLARE
  i INTEGER;
  post_no INTEGER;
  k INTEGER;
  profile_id UUID;
  post_id UUID;
  gender_value TEXT;
  first_name TEXT;
  family_name TEXT;
  country_value TEXT;
  city_value TEXT;
  interest_value TEXT;
  avatar_value TEXT;
  display_value TEXT;
  bio_value TEXT;
  caption_value TEXT;
  like_total INTEGER;
  comment_total INTEGER;
  female_names TEXT[] := ARRAY['Sofía','Valentina','Camila','Isabella','Mariana','Lucía','Daniela','Gabriela','Paola','Natalia','Renata','Elena','Carolina','Andrea','Julieta','Mía','Alma','Victoria','Sara','Antonella'];
  male_names TEXT[] := ARRAY['Mateo','Sebastián','Santiago','Gabriel','Daniel','Alejandro','Emiliano','Nicolás','Samuel','Diego','Andrés','Julián','Leonardo','Tomás','Adrián','Thiago','David','Bruno','Martín','Luca'];
  surnames TEXT[] := ARRAY['García','Rodríguez','Martínez','Hernández','López','Pérez','Gómez','Sánchez','Ramírez','Torres','Flores','Rivera','Díaz','Cruz','Morales','Ortiz','Reyes','Castro','Vargas','Rojas','Mendoza','Romero','Álvarez','Herrera','Medina','Aguilar','Navarro','Silva','Cabrera','Fuentes','Paredes'];
  countries TEXT[] := ARRAY['DO','CO','MX','ES','US','PR','VE','AR','CL','BR'];
  cities TEXT[] := ARRAY['Santo Domingo','Medellín','Ciudad de México','Madrid','Miami','San Juan','Caracas','Buenos Aires','Santiago','São Paulo','Cartagena','Punta Cana','Monterrey','Barcelona','Orlando','Cali','Valencia','Córdoba','Viña del Mar','Río de Janeiro'];
  interests TEXT[] := ARRAY['la música en vivo','el café de especialidad','los atardeceres junto al mar','viajar sin itinerario','la cocina casera','los libros y las buenas charlas','el baile y la bachata','las caminatas al aire libre','descubrir restaurantes nuevos','la fotografía de viajes','el cine y las series','los planes tranquilos con amigos'];
  bios TEXT[] := ARRAY['Creo en las conexiones que empiezan con una conversación sincera','Me gusta conocer lugares nuevos y quedarme con historias bonitas','Disfruto las cosas simples y la gente que sabe reírse de sí misma','Aquí para compartir buenos planes, música y conversaciones largas','Mi mejor versión aparece cuando estoy aprendiendo algo nuevo','Prefiero una charla auténtica a cualquier frase perfecta','Me encantan los domingos sin prisa y los viajes improvisados','Busco conocer personas alegres, respetuosas y con curiosidad'];
  captions TEXT[] := ARRAY['Un rincón bonito para guardar en la memoria','Pequeños momentos que hacen especial la semana','Plan sencillo, compañía bonita y cero prisa','Coleccionando lugares y buenas conversaciones','Hoy tocó salir a descubrir algo nuevo','Una pausa para disfrutar el camino','La mejor parte del día fue compartirlo','Un recuerdo más para mi álbum de aventuras'];
  comments TEXT[] := ARRAY['¡Qué lugar tan lindo!','Se nota que fue un día especial 😊','Me encanta ese plan, ¿lo recomiendas?','La luz de esa foto quedó preciosa ✨','Qué buena energía transmite esta publicación','Ese sitio ya está en mi lista para visitar','Un recuerdo así siempre alegra la semana','¡Saludos desde mi ciudad!'];
BEGIN
  FOR i IN 1..1000 LOOP
    gender_value := CASE WHEN i % 2 = 0 THEN 'woman' ELSE 'man' END;
    first_name := CASE WHEN gender_value = 'woman'
      THEN female_names[1 + ((i * 7) % array_length(female_names, 1))]
      ELSE male_names[1 + ((i * 7) % array_length(male_names, 1))] END;
    family_name := surnames[1 + ((i * 11) % array_length(surnames, 1))]
      || ' ' || surnames[1 + ((i * 17 + 3) % array_length(surnames, 1))];
    country_value := countries[1 + ((i * 7) % array_length(countries, 1))];
    city_value := cities[1 + ((i * 13) % array_length(cities, 1))];
    interest_value := interests[1 + ((i * 5) % array_length(interests, 1))];
    profile_id := md5('cupido-community-demo-profile-' || i)::uuid;
    display_value := first_name || ' ' || family_name;
    avatar_value := format('https://randomuser.me/api/portraits/%s/%s.jpg', CASE WHEN gender_value = 'woman' THEN 'women' ELSE 'men' END, 1 + ((i * 19 + i / 7) % 99));
    bio_value := format('%s. Soy %s, vivo en %s, disfruto %s y valoro las conversaciones con buena energía.',
      bios[1 + ((i * 3) % array_length(bios, 1))], display_value, city_value, interest_value);

    INSERT INTO public.cupido_demo_profiles
      (id, display_name, gender, age, country_code, bio, avatar_url, follower_count, is_demo, created_at)
    VALUES (profile_id, display_value, gender_value, (18 + ((i * 13) % 37))::smallint,
      country_value, bio_value, avatar_value, 120 + ((i * 7919) % 24381), TRUE,
      now() - ((i * 3) % 4320) * interval '1 minute')
    ON CONFLICT (id) DO NOTHING;

    FOR post_no IN 1..(3 + (i % 2)) LOOP
      post_id := md5(format('cupido-community-demo-post-%s-%s', i, post_no))::uuid;
      caption_value := format('%s · %s',
        captions[1 + ((i * 5 + post_no * 3) % array_length(captions, 1))],
        interests[1 + ((i + post_no * 7) % array_length(interests, 1))]);
      like_total := 12 + ((i * 7 + post_no * 13) % 55);
      comment_total := 2 + ((i + post_no) % 3);

      INSERT INTO public.cupido_demo_posts (id, profile_id, media_url, caption, is_demo, created_at)
      VALUES (post_id, profile_id, avatar_value, caption_value, TRUE,
        now() - ((i * 5 + post_no) % 4320) * interval '1 minute')
      ON CONFLICT (id) DO NOTHING;

      FOR k IN 1..like_total LOOP
        INSERT INTO public.cupido_demo_post_likes (post_id, demo_profile_id, is_demo)
        VALUES (post_id, md5('cupido-community-demo-profile-' || (1 + ((i + k + post_no) % 1000)))::uuid, TRUE)
        ON CONFLICT DO NOTHING;
      END LOOP;

      FOR k IN 1..comment_total LOOP
        INSERT INTO public.cupido_demo_post_comments (id, post_id, demo_profile_id, body, is_demo, created_at)
        VALUES (
          md5(format('cupido-community-demo-comment-%s-%s-%s', i, post_no, k))::uuid,
          post_id,
          md5('cupido-community-demo-profile-' || (1 + ((i + k + post_no + 7) % 1000)))::uuid,
          comments[1 + ((i * 3 + post_no + k * 5) % array_length(comments, 1))],
          TRUE,
          now() - ((i + post_no + k) % 1440) * interval '1 minute'
        ) ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW public.cupido_demo_public_feed WITH (security_invoker = true) AS
SELECT
  p.id,
  p.profile_id,
  u.display_name,
  u.avatar_url,
  u.age,
  u.country_code,
  u.bio,
  u.follower_count,
  p.media_url,
  p.caption,
  (SELECT count(*)::INTEGER FROM public.cupido_demo_post_likes AS l WHERE l.post_id = p.id) AS likes_count,
  (SELECT count(*)::INTEGER FROM public.cupido_demo_post_comments AS c WHERE c.post_id = p.id) AS comments_count,
  COALESCE(comment_rows.items, '[]'::jsonb) AS comments,
  p.created_at
FROM public.cupido_demo_posts AS p
JOIN public.cupido_demo_profiles AS u ON u.id = p.profile_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('display_name', c_profile.display_name, 'body', c.body)
                   ORDER BY c.created_at DESC) AS items
  FROM (
    SELECT demo_profile_id, body, created_at
    FROM public.cupido_demo_post_comments
    WHERE post_id = p.id
    ORDER BY created_at DESC
    LIMIT 3
  ) AS c
  JOIN public.cupido_demo_profiles AS c_profile ON c_profile.id = c.demo_profile_id
) AS comment_rows ON TRUE
WHERE p.is_demo AND u.is_demo;

GRANT SELECT ON public.cupido_demo_public_feed TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_demo_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_demo_posts;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_demo_post_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_demo_post_comments;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
