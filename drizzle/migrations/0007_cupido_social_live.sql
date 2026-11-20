ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS target_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_social_dedupe_idx
  ON public.notifications (actor_id, target_id, kind)
  WHERE actor_id IS NOT NULL AND target_id IS NOT NULL AND kind IN ('interest', 'follow', 'like');

CREATE TABLE IF NOT EXISTS public.cupido_gifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  cash NUMERIC(10, 2) NOT NULL CHECK (cash > 0),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cupido_live_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Live de Cupido Leudy ❤️',
  is_live BOOLEAN NOT NULL DEFAULT true,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.cupido_live_viewers (
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_live_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.cupido_gifts (id, name, emoji, credits, cash, sort_order) VALUES
  ('rosa-001', 'Rosa', '🌹', 10, 0.01, 1),
  ('cafe-002', 'Café', '☕', 25, 0.03, 2),
  ('beso-003', 'Beso', '💋', 50, 0.05, 3),
  ('corazon-004', 'Corazón', '❤️', 75, 0.07, 4),
  ('chispita-005', 'Chispita', '✨', 100, 0.10, 5),
  ('globito-006', 'Globito', '🎈', 150, 0.15, 6),
  ('caramelo-007', 'Caramelo', '🍬', 200, 0.20, 7),
  ('flor-008', 'Flor', '🌸', 250, 0.25, 8),
  ('velita-009', 'Velita', '🕯️', 300, 0.30, 9),
  ('dulce-010', 'Dulce', '🍭', 400, 0.40, 10),
  ('mariposa-011', 'Mariposa', '🦋', 500, 0.50, 11),
  ('estrella-012', 'Estrella', '⭐', 600, 0.60, 12),
  ('muffin-013', 'Muffin', '🧁', 700, 0.70, 13),
  ('taza-014', 'Taza', '☕', 800, 0.80, 14),
  ('ojito-015', 'Ojito', '👀', 900, 0.90, 15),
  ('sonrisa-016', 'Sonrisa', '😊', 1000, 1.00, 16),
  ('coqueteo-017', 'Coqueteo', '😉', 1200, 1.20, 17),
  ('brillo-018', 'Brillo', '💫', 1400, 1.40, 18),
  ('petalo-019', 'Pétalo', '🌷', 1600, 1.60, 19),
  ('miel-020', 'Miel', '🍯', 1800, 1.80, 20),
  ('limon-021', 'Limón', '🍋', 2000, 2.00, 21),
  ('fresa-022', 'Fresa', '🍓', 2200, 2.20, 22),
  ('uva-023', 'Uva', '🍇', 2400, 2.40, 23),
  ('cielo-024', 'Cielo', '☁️', 2600, 2.60, 24),
  ('luna-025', 'Luna', '🌙', 2800, 2.80, 25),
  ('sol-026', 'Sol', '☀️', 3000, 3.00, 26),
  ('arcoiris-027', 'Arcoíris', '🌈', 3500, 3.50, 27),
  ('confite-028', 'Confite', '🍬', 4000, 4.00, 28),
  ('cinta-029', 'Cinta', '🎀', 4500, 4.50, 29),
  ('cadenita-030', 'Cadenita', '🔗', 5000, 5.00, 30),
  ('ramo-031', 'Ramo', '💐', 6000, 6.00, 31),
  ('chocolate-032', 'Chocolate', '🍫', 6500, 6.50, 32),
  ('perfume-033', 'Perfume', '🌺', 7000, 7.00, 33),
  ('champan-034', 'Champán', '🍾', 7500, 7.50, 34),
  ('oso-gigante-035', 'Oso gigante', '🧸', 8000, 8.00, 35),
  ('anillo-036', 'Anillo', '💍', 8500, 8.50, 36),
  ('pulsera-037', 'Pulsera', '📿', 9000, 9.00, 37),
  ('collar-038', 'Collar', '🧿', 9500, 9.50, 38),
  ('reloj-039', 'Reloj', '⌚', 10000, 10.00, 39),
  ('gafas-040', 'Gafas', '🕶️', 10500, 10.50, 40),
  ('sombrero-041', 'Sombrero', '🎩', 11000, 11.00, 41),
  ('bufanda-042', 'Bufanda', '🧣', 11500, 11.50, 42),
  ('guantes-043', 'Guantes', '🧤', 12000, 12.00, 43),
  ('bolso-044', 'Bolso', '👜', 12500, 12.50, 44),
  ('zapatos-045', 'Zapatos', '👠', 13000, 13.00, 45),
  ('corbata-046', 'Corbata', '👔', 13500, 13.50, 46),
  ('ramo-de-oro-047', 'Ramo de oro', '💐', 14000, 14.00, 47),
  ('tarta-048', 'Tarta', '🎂', 14500, 14.50, 48),
  ('pastel-049', 'Pastel', '🍰', 15000, 15.00, 49),
  ('helado-050', 'Helado', '🍦', 15500, 15.50, 50),
  ('pizza-051', 'Pizza', '🍕', 16000, 16.00, 51),
  ('hamburguesa-052', 'Hamburguesa', '🍔', 16500, 16.50, 52),
  ('sushi-053', 'Sushi', '🍣', 17000, 17.00, 53),
  ('tacos-054', 'Tacos', '🌮', 17500, 17.50, 54),
  ('cafe-con-leche-055', 'Café con leche', '🥛', 18000, 18.00, 55),
  ('te-056', 'Té', '🍵', 18500, 18.50, 56),
  ('copa-057', 'Copa', '🍷', 19000, 19.00, 57),
  ('cerveza-058', 'Cerveza', '🍺', 19500, 19.50, 58),
  ('disco-059', 'Disco', '💿', 20000, 20.00, 59),
  ('boleto-060', 'Boleto', '🎟️', 20500, 20.50, 60),
  ('auto-061', 'Auto', '🏎️', 21000, 21.00, 61),
  ('moto-062', 'Moto', '🏍️', 22500, 22.50, 62),
  ('bicicleta-063', 'Bicicleta', '🚲', 24000, 24.00, 63),
  ('barco-064', 'Barco', '⛵', 25500, 25.50, 64),
  ('avioneta-065', 'Avioneta', '🛩️', 27000, 27.00, 65),
  ('globo-aerostatico-066', 'Globo aerostático', '🎈', 28500, 28.50, 66),
  ('castillo-067', 'Castillo', '🏰', 30000, 30.00, 67),
  ('casa-068', 'Casa', '🏠', 31500, 31.50, 68),
  ('villa-069', 'Villa', '🏖️', 33000, 33.00, 69),
  ('lancha-070', 'Lancha', '🚤', 34500, 34.50, 70),
  ('concierto-071', 'Concierto', '🎤', 36000, 36.00, 71),
  ('viaje-072', 'Viaje', '✈️', 37500, 37.50, 72),
  ('hotel-073', 'Hotel', '🏨', 39000, 39.00, 73),
  ('spa-074', 'Spa', '💆', 40500, 40.50, 74),
  ('gimnasio-075', 'Gimnasio', '🏋️', 42000, 42.00, 75),
  ('biblioteca-076', 'Biblioteca', '📚', 43500, 43.50, 76),
  ('estadio-077', 'Estadio', '🏟️', 45000, 45.00, 77),
  ('cine-078', 'Cine', '🎬', 46500, 46.50, 78),
  ('crucero-079', 'Crucero', '🚢', 48000, 48.00, 79),
  ('isla-080', 'Isla', '🏝️', 49500, 49.50, 80),
  ('yate-081', 'Yate', '🛥️', 50000, 50.00, 81),
  ('mansion-082', 'Mansión', '🏰', 55000, 55.00, 82),
  ('jet-privado-083', 'Jet privado', '🛩️', 60000, 60.00, 83),
  ('corona-suprema-084', 'Corona suprema', '👑', 65000, 65.00, 84),
  ('diamante-085', 'Diamante', '💎', 70000, 70.00, 85),
  ('rubi-086', 'Rubí', '🔴', 75000, 75.00, 86),
  ('esmeralda-087', 'Esmeralda', '🟢', 80000, 80.00, 87),
  ('perla-088', 'Perla', '🦪', 85000, 85.00, 88),
  ('oro-089', 'Oro', '🪙', 90000, 90.00, 89),
  ('trono-090', 'Trono', '🪑', 95000, 95.00, 90),
  ('limusina-091', 'Limusina', '🚘', 100000, 100.00, 91),
  ('helicoptero-092', 'Helicóptero', '🚁', 110000, 110.00, 92),
  ('avion-privado-093', 'Avión privado', '✈️', 120000, 120.00, 93),
  ('isla-privada-094', 'Isla privada', '🏝️', 130000, 130.00, 94),
  ('castillo-real-095', 'Castillo real', '🏰', 140000, 140.00, 95),
  ('tesoro-096', 'Tesoro', '💰', 150000, 150.00, 96),
  ('cofre-097', 'Cofre', '🗝️', 175000, 175.00, 97),
  ('galaxia-098', 'Galaxia', '🌌', 200000, 200.00, 98),
  ('corona-eterna-099', 'Corona eterna', '👑', 250000, 250.00, 99)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, emoji = EXCLUDED.emoji, credits = EXCLUDED.credits,
  cash = EXCLUDED.cash, sort_order = EXCLUDED.sort_order;

ALTER TABLE public.cupido_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido gifts readable" ON public.cupido_gifts;
CREATE POLICY "cupido gifts readable" ON public.cupido_gifts FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "cupido live rooms readable" ON public.cupido_live_rooms;
CREATE POLICY "cupido live rooms readable" ON public.cupido_live_rooms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cupido live viewers readable" ON public.cupido_live_viewers;
CREATE POLICY "cupido live viewers readable" ON public.cupido_live_viewers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cupido live viewers join" ON public.cupido_live_viewers;
CREATE POLICY "cupido live viewers join" ON public.cupido_live_viewers FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cupido live viewers leave" ON public.cupido_live_viewers;
CREATE POLICY "cupido live viewers leave" ON public.cupido_live_viewers FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cupido live signals readable" ON public.cupido_live_signals;
CREATE POLICY "cupido live signals readable" ON public.cupido_live_signals FOR SELECT TO authenticated USING (
  sender_id = auth.uid()
  OR receiver_id = auth.uid()
  OR receiver_id IS NULL
  OR EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.host_id = auth.uid())
);
DROP POLICY IF EXISTS "cupido live signals send" ON public.cupido_live_signals;
CREATE POLICY "cupido live signals send" ON public.cupido_live_signals FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

GRANT SELECT ON public.cupido_gifts TO anon, authenticated;
GRANT SELECT ON public.cupido_live_rooms TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.cupido_live_viewers TO authenticated;
GRANT SELECT, INSERT ON public.cupido_live_signals TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_sync_live_viewers()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_room UUID;
BEGIN
  target_room := COALESCE(NEW.room_id, OLD.room_id);
  UPDATE public.cupido_live_rooms
    SET viewer_count = (SELECT COUNT(*) FROM public.cupido_live_viewers WHERE room_id = target_room)
    WHERE id = target_room;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cupido_live_viewers_count ON public.cupido_live_viewers;
CREATE TRIGGER cupido_live_viewers_count AFTER INSERT OR DELETE ON public.cupido_live_viewers
  FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_live_viewers();

CREATE OR REPLACE FUNCTION public.cupido_notify_profile_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.kind = 'interested' THEN
    DELETE FROM public.notifications
      WHERE user_id = OLD.target_id AND kind = 'interest' AND actor_id = OLD.actor_id AND target_id = OLD.actor_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.kind = 'interested' AND NEW.actor_id <> NEW.target_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
        WHERE user_id = NEW.target_id AND kind = 'interest' AND actor_id = NEW.actor_id AND target_id = NEW.actor_id
    ) THEN
      INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
        VALUES (NEW.target_id, 'Te interesa a alguien ❤️', 'Alguien marcó que le interesa tu perfil.', 'interest', NEW.actor_id, NEW.actor_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cupido_notify_profile_like ON public.cupido_likes;
CREATE TRIGGER cupido_notify_profile_like AFTER INSERT OR UPDATE OR DELETE ON public.cupido_likes
  FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_profile_like();

CREATE OR REPLACE FUNCTION public.cupido_notify_post_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post_owner UUID;
BEGIN
  SELECT user_id INTO post_owner FROM public.cupido_posts WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  IF TG_OP = 'INSERT' AND post_owner IS NOT NULL AND post_owner <> NEW.user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
        WHERE user_id = post_owner AND kind = 'like' AND actor_id = NEW.user_id AND target_id = NEW.post_id
    ) THEN
      INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
        VALUES (post_owner, '❤️ Te gusta en tu publicación', 'A alguien le gustó tu foto o video.', 'like', NEW.user_id, NEW.post_id);
    END IF;
  ELSIF TG_OP = 'DELETE' AND post_owner IS NOT NULL THEN
    DELETE FROM public.notifications
      WHERE user_id = post_owner AND kind = 'like' AND actor_id = OLD.user_id AND target_id = OLD.post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cupido_notify_post_like ON public.cupido_post_likes;
CREATE TRIGGER cupido_notify_post_like AFTER INSERT OR DELETE ON public.cupido_post_likes
  FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_post_like();

CREATE OR REPLACE FUNCTION public.cupido_notify_follow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.follower_id <> NEW.following_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
        WHERE user_id = NEW.following_id AND kind = 'follow' AND actor_id = NEW.follower_id AND target_id = NEW.follower_id
    ) THEN
      INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
        VALUES (NEW.following_id, 'Nuevo seguidor 👤', 'Alguien ahora te sigue en Cupido Leudy.', 'follow', NEW.follower_id, NEW.follower_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications
      WHERE user_id = OLD.following_id AND kind = 'follow' AND actor_id = OLD.follower_id AND target_id = OLD.follower_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cupido_notify_follow ON public.follows;
CREATE TRIGGER cupido_notify_follow AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_follow();

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_like(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_liked BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_post_likes WHERE post_id = _post AND user_id = auth.uid();
  IF FOUND THEN
    is_liked := false;
  ELSE
    INSERT INTO public.cupido_post_likes (post_id, user_id) VALUES (_post, auth.uid());
    is_liked := true;
  END IF;
  RETURN is_liked;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_set_like(_target UUID, _kind TEXT, _remove BOOLEAN DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = auth.uid() THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF _kind NOT IN ('interested', 'pass') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  DELETE FROM public.cupido_likes WHERE actor_id = auth.uid() AND target_id = _target;
  IF NOT _remove THEN
    INSERT INTO public.cupido_likes (actor_id, target_id, kind) VALUES (auth.uid(), _target, _kind);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_is_verified_user(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_verified_blue FROM public.creator_profiles WHERE id = p_user), false)
    OR public.has_role(p_user, 'admin')
    OR public.has_role(p_user, 'admin_supremo');
$$;

CREATE OR REPLACE FUNCTION public.cupido_start_live_room(_title TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.cupido_is_verified_user(auth.uid()) THEN RAISE EXCEPTION 'NOT_VERIFIED'; END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title)
    VALUES (auth.uid(), COALESCE(NULLIF(_title, ''), 'Live de Cupido Leudy ❤️'))
    RETURNING id INTO room_id;
  RETURN room_id;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_end_live_room(_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.cupido_live_rooms
    SET is_live = false, ended_at = now()
    WHERE id = _id
      AND (host_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo'));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = auth.uid() THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cupido_gifts
      WHERE id = _gift_id AND credits = _credits AND cash = _cash_value
  ) THEN RAISE EXCEPTION 'INVALID_GIFT'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    UPDATE public.user_credits SET balance = balance - _credits, updated_at = now()
      WHERE user_id = auth.uid() AND balance >= _credits;
    IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
      VALUES (auth.uid(), -_credits, 'Regalo enviado en Cupido Leudy');
  END IF;
  INSERT INTO public.cupido_balances (user_id, balance) VALUES (_receiver, _cash_value)
    ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + _cash_value, updated_at = now();
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
    VALUES (auth.uid(), _receiver, _gift_id, _credits, _cash_value) RETURNING id INTO gid;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
    VALUES (_receiver, 'Recibiste un regalo ❤️', 'El valor de tu regalo ya está disponible como saldo retirable.', 'gift', auth.uid(), _receiver);
  RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _room UUID, _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms
      WHERE id = _room AND is_live = true AND host_id = _receiver
  ) THEN RAISE EXCEPTION 'INVALID_LIVE_ROOM'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cupido_gifts
      WHERE id = _gift_id AND credits = _credits AND cash = _cash_value
  ) THEN RAISE EXCEPTION 'INVALID_GIFT'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    UPDATE public.user_credits SET balance = balance - _credits, updated_at = now()
      WHERE user_id = auth.uid() AND balance >= _credits;
    IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
      VALUES (auth.uid(), -_credits, 'Regalo en vivo en Cupido Leudy');
  END IF;
  INSERT INTO public.cupido_balances (user_id, balance) VALUES (_receiver, _cash_value)
    ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + _cash_value, updated_at = now();
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
    VALUES (auth.uid(), _receiver, _gift_id, _credits, _cash_value) RETURNING id INTO gid;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
    VALUES (_receiver, 'Regalo en vivo 🎁', 'Recibiste un regalo durante tu Live y ya es saldo retirable.', 'live_gift', auth.uid(), _room);
  RETURN gid;
END $$;

GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_like(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_set_like(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_room(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_end_live_room(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, UUID, TEXT, INTEGER, NUMERIC) TO authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cupido_gifts', 'cupido_live_rooms', 'cupido_live_signals', 'cupido_live_viewers',
    'cupido_likes', 'cupido_post_likes', 'notifications'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
