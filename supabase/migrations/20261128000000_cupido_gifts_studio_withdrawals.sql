BEGIN;

CREATE TABLE IF NOT EXISTS public.cupido_gifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  cash NUMERIC(12,2) NOT NULL CHECK (cash >= 0),
  sort_order INTEGER NOT NULL
);

UPDATE public.cupido_gifts
SET sort_order = sort_order + 1000
WHERE sort_order < 1000
  AND id NOT IN ('gift-001', 'gift-002', 'gift-003', 'gift-004', 'gift-005', 'gift-006', 'gift-007', 'gift-008', 'gift-009', 'gift-010', 'gift-011', 'gift-012', 'gift-013', 'gift-014', 'gift-015', 'gift-016', 'gift-017', 'gift-018', 'gift-019', 'gift-020', 'gift-021', 'gift-022', 'gift-023', 'gift-024', 'gift-025', 'gift-026', 'gift-027', 'gift-028', 'gift-029', 'gift-030', 'gift-031', 'gift-032', 'gift-033', 'gift-034', 'gift-035', 'gift-036', 'gift-037', 'gift-038', 'gift-039', 'gift-040', 'gift-041', 'gift-042', 'gift-043', 'gift-044', 'gift-045', 'gift-046', 'gift-047', 'gift-048', 'gift-049', 'gift-050', 'gift-051', 'gift-052', 'gift-053', 'gift-054', 'gift-055', 'gift-056', 'gift-057', 'gift-058', 'gift-059', 'gift-060', 'gift-061', 'gift-062', 'gift-063', 'gift-064', 'gift-065', 'gift-066', 'gift-067', 'gift-068', 'gift-069', 'gift-070', 'gift-071', 'gift-072', 'gift-073', 'gift-074', 'gift-075', 'gift-076', 'gift-077', 'gift-078', 'gift-079', 'gift-080', 'gift-081', 'gift-082', 'gift-083', 'gift-084', 'gift-085', 'gift-086', 'gift-087', 'gift-088', 'gift-089', 'gift-090', 'gift-091', 'gift-092', 'gift-093', 'gift-094', 'gift-095', 'gift-096', 'gift-097', 'gift-098', 'gift-099');

INSERT INTO public.cupido_gifts (id, name, emoji, credits, cash, sort_order)
VALUES
  ('gift-001', 'Rosa', '🌹', 10, ROUND(10::NUMERIC / 1000, 2), 1),
  ('gift-002', 'Corazón', '❤️', 15, ROUND(15::NUMERIC / 1000, 2), 2),
  ('gift-003', 'Corona', '👑', 20, ROUND(20::NUMERIC / 1000, 2), 3),
  ('gift-004', 'Estrella', '⭐', 25, ROUND(25::NUMERIC / 1000, 2), 4),
  ('gift-005', 'Corona Real', '👑', 30, ROUND(30::NUMERIC / 1000, 2), 5),
  ('gift-006', 'Cohete', '🚀', 40, ROUND(40::NUMERIC / 1000, 2), 6),
  ('gift-007', 'Panda', '🐼', 50, ROUND(50::NUMERIC / 1000, 2), 7),
  ('gift-008', 'Osito', '🧸', 60, ROUND(60::NUMERIC / 1000, 2), 8),
  ('gift-009', 'Unicornio', '🦄', 75, ROUND(75::NUMERIC / 1000, 2), 9),
  ('gift-010', 'Gato', '😎', 100, ROUND(100::NUMERIC / 1000, 2), 10),
  ('gift-011', 'Conejo', '🐰', 155, ROUND(155::NUMERIC / 1000, 2), 11),
  ('gift-012', 'Dinosaurio', '🦖', 210, ROUND(210::NUMERIC / 1000, 2), 12),
  ('gift-013', 'Robot', '🤖', 265, ROUND(265::NUMERIC / 1000, 2), 13),
  ('gift-014', 'Pollito', '🐥', 320, ROUND(320::NUMERIC / 1000, 2), 14),
  ('gift-015', 'Pingüino', '🐧', 375, ROUND(375::NUMERIC / 1000, 2), 15),
  ('gift-016', 'Tiburón', '🦈', 430, ROUND(430::NUMERIC / 1000, 2), 16),
  ('gift-017', 'Pulpo', '🐙', 485, ROUND(485::NUMERIC / 1000, 2), 17),
  ('gift-018', 'Pato', '🐤', 540, ROUND(540::NUMERIC / 1000, 2), 18),
  ('gift-019', 'Regalo', '🎁', 595, ROUND(595::NUMERIC / 1000, 2), 19),
  ('gift-020', 'Ramo de Rosas', '💐', 650, ROUND(650::NUMERIC / 1000, 2), 20),
  ('gift-021', 'Champán', '🍾', 705, ROUND(705::NUMERIC / 1000, 2), 21),
  ('gift-022', 'Bubble Tea', '🧋', 760, ROUND(760::NUMERIC / 1000, 2), 22),
  ('gift-023', 'Palomitas', '🍿', 815, ROUND(815::NUMERIC / 1000, 2), 23),
  ('gift-024', 'Papas Fritas', '🍟', 870, ROUND(870::NUMERIC / 1000, 2), 24),
  ('gift-025', 'Pastel de Cumpleaños', '🎂', 925, ROUND(925::NUMERIC / 1000, 2), 25),
  ('gift-026', 'Helado de Cono', '🍦', 980, ROUND(980::NUMERIC / 1000, 2), 26),
  ('gift-027', 'Globo Aerostático', '🎈', 1035, ROUND(1035::NUMERIC / 1000, 2), 27),
  ('gift-028', 'Auto Deportivo', '🏎️', 1090, ROUND(1090::NUMERIC / 1000, 2), 28),
  ('gift-029', 'Motocicleta', '🏍️', 1145, ROUND(1145::NUMERIC / 1000, 2), 29),
  ('gift-030', 'Avión', '✈️', 1200, ROUND(1200::NUMERIC / 1000, 2), 30),
  ('gift-031', 'Yate', '🛥️', 1255, ROUND(1255::NUMERIC / 1000, 2), 31),
  ('gift-032', 'Castillo', '🏰', 1310, ROUND(1310::NUMERIC / 1000, 2), 32),
  ('gift-033', 'Rueda de la Fortuna', '🎡', 1365, ROUND(1365::NUMERIC / 1000, 2), 33),
  ('gift-034', 'Auriculares', '🎧', 1420, ROUND(1420::NUMERIC / 1000, 2), 34),
  ('gift-035', 'Cámara', '📷', 1475, ROUND(1475::NUMERIC / 1000, 2), 35),
  ('gift-036', 'Control de Videojuegos', '🎮', 1530, ROUND(1530::NUMERIC / 1000, 2), 36),
  ('gift-037', 'Teléfono', '📱', 1585, ROUND(1585::NUMERIC / 1000, 2), 37),
  ('gift-038', 'Laptop', '💻', 1640, ROUND(1640::NUMERIC / 1000, 2), 38),
  ('gift-039', 'Reloj Inteligente', '⌚', 1695, ROUND(1695::NUMERIC / 1000, 2), 39),
  ('gift-040', 'Cofre del Tesoro', '🧰', 1750, ROUND(1750::NUMERIC / 1000, 2), 40),
  ('gift-041', 'Saco de Dinero', '💰', 1805, ROUND(1805::NUMERIC / 1000, 2), 41),
  ('gift-042', 'Pila de Monedas', '🪙', 1860, ROUND(1860::NUMERIC / 1000, 2), 42),
  ('gift-043', 'Diamante Azul', '💎', 1915, ROUND(1915::NUMERIC / 1000, 2), 43),
  ('gift-044', 'Corona de Diamantes', '👑', 1970, ROUND(1970::NUMERIC / 1000, 2), 44),
  ('gift-045', 'Poción Mágica', '🧪', 2025, ROUND(2025::NUMERIC / 1000, 2), 45),
  ('gift-046', 'Bola de Cristal', '🔮', 2080, ROUND(2080::NUMERIC / 1000, 2), 46),
  ('gift-047', 'Varita Mágica', '🪄', 2135, ROUND(2135::NUMERIC / 1000, 2), 47),
  ('gift-048', 'Globo de Nieve', '🔮', 2190, ROUND(2190::NUMERIC / 1000, 2), 48),
  ('gift-049', 'Muñeco de Nieve', '⛄', 2245, ROUND(2245::NUMERIC / 1000, 2), 49),
  ('gift-050', 'Árbol de Navidad', '🎄', 2300, ROUND(2300::NUMERIC / 1000, 2), 50),
  ('gift-051', 'Calabaza', '🎃', 2355, ROUND(2355::NUMERIC / 1000, 2), 51),
  ('gift-052', 'Fantasma', '👻', 2410, ROUND(2410::NUMERIC / 1000, 2), 52),
  ('gift-053', 'Sombrero de Bruja', '🧙', 2465, ROUND(2465::NUMERIC / 1000, 2), 53),
  ('gift-054', 'Gato Negro', '🐈‍⬛', 2520, ROUND(2520::NUMERIC / 1000, 2), 54),
  ('gift-055', 'Calavera Real', '💀', 2580, ROUND(2580::NUMERIC / 1000, 2), 55),
  ('gift-056', 'Diablito', '👹', 2635, ROUND(2635::NUMERIC / 1000, 2), 56),
  ('gift-057', 'Ángel Bebé', '👼', 2690, ROUND(2690::NUMERIC / 1000, 2), 57),
  ('gift-058', 'Cupido', '💘', 2745, ROUND(2745::NUMERIC / 1000, 2), 58),
  ('gift-059', 'Corazón Alado', '💝', 2800, ROUND(2800::NUMERIC / 1000, 2), 59),
  ('gift-060', 'Linterna', '🏮', 2855, ROUND(2855::NUMERIC / 1000, 2), 60),
  ('gift-061', 'Lazo Rosa', '🎀', 2910, ROUND(2910::NUMERIC / 1000, 2), 61),
  ('gift-062', 'Rosa en Cúpula', '🌹', 2965, ROUND(2965::NUMERIC / 1000, 2), 62),
  ('gift-063', 'Alas de Ángel', '🪽', 3020, ROUND(3020::NUMERIC / 1000, 2), 63),
  ('gift-064', 'Arcoíris', '🌈', 3075, ROUND(3075::NUMERIC / 1000, 2), 64),
  ('gift-065', 'Nube', '☁️', 3130, ROUND(3130::NUMERIC / 1000, 2), 65),
  ('gift-066', 'Sol', '🌞', 3185, ROUND(3185::NUMERIC / 1000, 2), 66),
  ('gift-067', 'Luna', '🌙', 3240, ROUND(3240::NUMERIC / 1000, 2), 67),
  ('gift-068', 'Nube Estrellada', '🌟', 3295, ROUND(3295::NUMERIC / 1000, 2), 68),
  ('gift-069', 'Estrella Fugaz', '🌠', 3350, ROUND(3350::NUMERIC / 1000, 2), 69),
  ('gift-070', 'Mariposa', '🦋', 3405, ROUND(3405::NUMERIC / 1000, 2), 70),
  ('gift-071', 'Macaron', '🍬', 3460, ROUND(3460::NUMERIC / 1000, 2), 71),
  ('gift-072', 'Rebanada de Pastel', '🍰', 3515, ROUND(3515::NUMERIC / 1000, 2), 72),
  ('gift-073', 'Bubble Tea', '🧋', 3570, ROUND(3570::NUMERIC / 1000, 2), 73),
  ('gift-074', 'Café Corazón', '☕', 3625, ROUND(3625::NUMERIC / 1000, 2), 74),
  ('gift-075', 'Taza Corazón', '💗', 3680, ROUND(3680::NUMERIC / 1000, 2), 75),
  ('gift-076', 'Cupcake', '🧁', 3735, ROUND(3735::NUMERIC / 1000, 2), 76),
  ('gift-077', 'Dona', '🍩', 3790, ROUND(3790::NUMERIC / 1000, 2), 77),
  ('gift-078', 'Helado de Chocolate', '🍨', 3845, ROUND(3845::NUMERIC / 1000, 2), 78),
  ('gift-079', 'Regalo', '🎁', 3900, ROUND(3900::NUMERIC / 1000, 2), 79),
  ('gift-080', 'Paleta', '🍭', 3955, ROUND(3955::NUMERIC / 1000, 2), 80),
  ('gift-081', 'Cerezas', '🍒', 4010, ROUND(4010::NUMERIC / 1000, 2), 81),
  ('gift-082', 'Rosa en Cúpula', '🌹', 4065, ROUND(4065::NUMERIC / 1000, 2), 82),
  ('gift-083', 'Panda', '🐼', 4120, ROUND(4120::NUMERIC / 1000, 2), 83),
  ('gift-084', 'Zorro', '🦊', 4175, ROUND(4175::NUMERIC / 1000, 2), 84),
  ('gift-085', 'Gato Gris', '🐈', 4230, ROUND(4230::NUMERIC / 1000, 2), 85),
  ('gift-086', 'Tortuga', '🐢', 4285, ROUND(4285::NUMERIC / 1000, 2), 86),
  ('gift-087', 'Rana con Corona', '🐸', 4340, ROUND(4340::NUMERIC / 1000, 2), 87),
  ('gift-088', 'Pingüino', '🐧', 4395, ROUND(4395::NUMERIC / 1000, 2), 88),
  ('gift-089', 'Erizo', '🦔', 4450, ROUND(4450::NUMERIC / 1000, 2), 89),
  ('gift-090', 'Ardilla', '🐿️', 4505, ROUND(4505::NUMERIC / 1000, 2), 90),
  ('gift-091', 'Gato en una Nube', '😽', 4560, ROUND(4560::NUMERIC / 1000, 2), 91),
  ('gift-092', 'Delfín', '🐬', 4615, ROUND(4615::NUMERIC / 1000, 2), 92),
  ('gift-093', 'Medusa', '🪼', 4670, ROUND(4670::NUMERIC / 1000, 2), 93),
  ('gift-094', 'Ballena', '🐳', 4725, ROUND(4725::NUMERIC / 1000, 2), 94),
  ('gift-095', 'Panda en una Nube', '🐼', 4780, ROUND(4780::NUMERIC / 1000, 2), 95),
  ('gift-096', 'Zorro Bebé', '🦊', 4835, ROUND(4835::NUMERIC / 1000, 2), 96),
  ('gift-097', 'Oveja', '🐑', 4890, ROUND(4890::NUMERIC / 1000, 2), 97),
  ('gift-098', 'Reno', '🦌', 4945, ROUND(4945::NUMERIC / 1000, 2), 98),
  ('gift-099', 'Cerdito Dorado', '🐷', 5000, ROUND(5000::NUMERIC / 1000, 2), 99)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    emoji = EXCLUDED.emoji,
    credits = EXCLUDED.credits,
    cash = EXCLUDED.cash,
    sort_order = EXCLUDED.sort_order;

ALTER TABLE public.cupido_balances
  ALTER COLUMN balance TYPE NUMERIC(20,2) USING balance::NUMERIC(20,2);
ALTER TABLE public.cupido_withdrawals
  ALTER COLUMN amount TYPE NUMERIC(20,2) USING amount::NUMERIC(20,2);

DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cupido_withdrawals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.cupido_withdrawals DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.cupido_withdrawals
  ADD CONSTRAINT cupido_withdrawals_status_check
  CHECK (status IN ('pending', 'pagado', 'approved', 'rejected'));

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
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;

  SELECT *
  INTO gift
  FROM public.cupido_gifts
  WHERE id = _gift_id
    AND sort_order BETWEEN 1 AND 99
    AND credits BETWEEN 10 AND 5000;

  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.cupido_live_rooms
    WHERE id = _room AND host_id = _receiver AND is_live
  ) THEN
    RAISE EXCEPTION 'LIVE_NOT_ACTIVE';
  END IF;

  is_admin := public.has_role(sender, 'admin') OR public.has_role(sender, 'admin_supremo');
  IF gift.credits > 500
     AND NOT is_admin
     AND NOT EXISTS (
       SELECT 1
       FROM public.paypal_orders
       WHERE user_id = sender AND status = 'captured'
     ) THEN
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
        updated_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (
    _receiver,
    'Recibiste un regalo',
    'Tu saldo retirable se actualizó con un regalo de Cupido.',
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END,
    sender,
    send_id
  );

  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID,
  _gift_id TEXT,
  _credits INTEGER,
  _cash_value NUMERIC
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _receiver UUID,
  _gift_id TEXT,
  _credits INTEGER,
  _cash_value NUMERIC,
  _room UUID
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;

REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_call(_callee UUID, _mode TEXT, _video BOOLEAN DEFAULT FALSE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cost INTEGER;
  call_id UUID;
  admin_user BOOLEAN;
  is_supreme BOOLEAN :=
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin_supremo');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = auth.uid() THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;

  cost := CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END;
  admin_user := is_supreme OR public.has_role(auth.uid(), 'admin');

  IF NOT admin_user THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.paypal_orders
      WHERE user_id = auth.uid() AND status = 'captured'
    ) THEN
      RAISE EXCEPTION 'PURCHASE_REQUIRED';
    END IF;
    PERFORM public.consume_credits(cost, 'Llamada Cupido ' || _mode);
  ELSE
    cost := 0;
  END IF;

  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, video, credits_spent)
  VALUES (auth.uid(), _callee, _mode, COALESCE(_video, FALSE), cost)
  RETURNING id INTO call_id;

  RETURN call_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_request_withdrawal(
  _amount NUMERIC,
  _country_code TEXT,
  _method TEXT,
  _account_details TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id UUID := auth.uid();
  available NUMERIC(20,2);
  withdrawal_id UUID;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount < 20 THEN RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_20'; END IF;
  IF NULLIF(btrim(_country_code), '') IS NULL
     OR NULLIF(btrim(_method), '') IS NULL
     OR NULLIF(btrim(_account_details), '') IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_DETAILS_REQUIRED';
  END IF;

  SELECT balance
  INTO available
  FROM public.cupido_balances
  WHERE user_id = current_id
  FOR UPDATE;

  IF COALESCE(available, 0) < _amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_WITHDRAWABLE_BALANCE';
  END IF;

  UPDATE public.cupido_balances
  SET balance = balance - _amount, updated_at = now()
  WHERE user_id = current_id;

  INSERT INTO public.cupido_withdrawals
    (user_id, amount, country_code, method, account_details, status)
  VALUES
    (current_id, _amount, upper(btrim(_country_code)), btrim(_method), btrim(_account_details), 'pending')
  RETURNING id INTO withdrawal_id;

  RETURN withdrawal_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_review_withdrawal(_id UUID, _approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  withdrawal_row public.cupido_withdrawals%ROWTYPE;
  official_user UUID;
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT *
  INTO withdrawal_row
  FROM public.cupido_withdrawals
  WHERE id = _id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PENDING'; END IF;

  UPDATE public.cupido_withdrawals
  SET status = CASE WHEN _approve THEN 'pagado' ELSE 'rejected' END,
      reviewed_at = now()
  WHERE id = _id;

  IF NOT _approve THEN
    INSERT INTO public.cupido_balances (user_id, balance, updated_at)
    VALUES (withdrawal_row.user_id, withdrawal_row.amount, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.cupido_balances.balance + EXCLUDED.balance,
          updated_at = now();
    RETURN;
  END IF;

  SELECT p.id
  INTO official_user
  FROM public.profiles p
  WHERE lower(p.email) = 'leudyfeliz81@gmail.com'
  ORDER BY p.created_at
  LIMIT 1;

  INSERT INTO public.notifications
    (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES
    (
      withdrawal_row.user_id,
      'Pagado',
      'Tu retiro fue pagado por el perfil oficial Moneda de Oro.',
      'withdrawal_paid',
      official_user,
      withdrawal_row.id,
      '/tienda'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_review_withdrawal(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_studio_analytics()
RETURNS TABLE (
  video_id UUID,
  creator_id UUID,
  creator_name TEXT,
  country_code TEXT,
  follower_count BIGINT,
  video_title TEXT,
  views_count BIGINT,
  watched_seconds BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer UUID := auth.uid();
  global_view BOOLEAN :=
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
BEGIN
  IF viewer IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  RETURN QUERY
  SELECT
    post.id,
    creator.id,
    COALESCE(NULLIF(creator.display_name, ''), 'Miembro de Cupido'),
    COALESCE(NULLIF(upper(creator.country_code), ''), 'ZZ'),
    COALESCE(creator.follower_count, 0)::BIGINT,
    COALESCE(NULLIF(btrim(post.caption), ''), 'Video sin título'),
    COALESCE(post.views_count, 0)::BIGINT,
    COALESCE(SUM(watch.watched_seconds), 0)::BIGINT,
    post.created_at
  FROM public.cupido_posts post
  JOIN public.creator_profiles creator ON creator.id = post.user_id
  LEFT JOIN public.cupido_video_watch_events watch ON watch.post_id = post.id
  WHERE post.kind = 'video'
    AND post.moderation_status = 'approved'
    AND (global_view OR post.user_id = viewer)
  GROUP BY post.id, creator.id, creator.display_name, creator.country_code,
           creator.follower_count, post.caption, post.views_count, post.created_at
  ORDER BY post.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_studio_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_studio_analytics() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
