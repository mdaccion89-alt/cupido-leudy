alter table public.profiles add column if not exists has_purchased boolean not null default false;

update public.profiles p
set has_purchased = true
where exists (
  select 1 from public.paypal_orders o
  where o.user_id = p.id and o.status = 'captured'
);

drop policy if exists "Admin reads payment settings" on public.payment_settings;
create policy "Admin reads payment settings" on public.payment_settings for select to authenticated
using (
  public.has_role(auth.uid(), 'admin')
  or lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
);

drop policy if exists "Admin updates payment settings" on public.payment_settings;
create policy "Admin updates payment settings" on public.payment_settings for update to authenticated
using (
  public.has_role(auth.uid(), 'admin')
  or lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
)
with check (
  public.has_role(auth.uid(), 'admin')
  or lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
);

drop policy if exists "Admin inserts payment settings" on public.payment_settings;
create policy "Admin inserts payment settings" on public.payment_settings for insert to authenticated
with check (
  id = 1
  and (
    public.has_role(auth.uid(), 'admin')
    or lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
  )
);

grant insert on public.payment_settings to authenticated;

create or replace function public.cupido_is_verified_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_verified_blue from public.creator_profiles where id = p_user), false)
    or public.has_role(p_user, 'admin')
    or public.has_role(p_user, 'admin_supremo')
    or exists (
      select 1 from auth.users u
      where u.id = p_user and lower(coalesce(u.email, '')) = 'leudyfeliz81@gmail.com'
    );
$$;

create or replace function public.apply_daily_refill(_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old_balance integer;
begin
  insert into public.user_credits (user_id, balance, daily_reset_at) values (_uid, 500, now())
    on conflict (user_id) do nothing;
  select balance into old_balance from public.user_credits
    where user_id = _uid and daily_reset_at <= now() - interval '24 hours' for update;
  if found then
    update public.user_credits set balance = greatest(balance, 500), daily_reset_at = now(), updated_at = now() where user_id = _uid;
    if old_balance < 500 then
      insert into public.credit_transactions (user_id, delta, reason) values (_uid, 500 - old_balance, 'Créditos diarios');
    end if;
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare dname text;
begin
  dname := left(coalesce(nullif(NEW.raw_user_meta_data->>'full_name', ''), nullif(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1), 'Miembro de Cupido'), 60);
  insert into public.profiles (id, email, display_name, full_name, birth_date)
  values (NEW.id, NEW.email, dname, nullif(left(NEW.raw_user_meta_data->>'full_name', 120), ''), public.try_date(NEW.raw_user_meta_data->>'birth_date'))
  on conflict (id) do nothing;
  insert into public.creator_profiles (id, display_name, is_official)
  values (NEW.id, dname, lower(coalesce(NEW.email, '')) = 'leudyfeliz81@gmail.com')
  on conflict (id) do nothing;
  insert into public.user_credits (user_id, balance, daily_reset_at) values (NEW.id, 500, now()) on conflict (user_id) do nothing;
  insert into public.credit_transactions (user_id, delta, reason) values (NEW.id, 500, 'Créditos gratis de bienvenida Cupido Leudy ❤️');
  insert into public.user_roles (user_id, role) values (NEW.id, 'user') on conflict do nothing;
  if lower(coalesce(NEW.email, '')) = 'leudyfeliz81@gmail.com' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'admin') on conflict do nothing;
  end if;
  return NEW;
end;
$$;

create or replace function public.cupido_adapt_legacy_profile()
returns void language plpgsql security definer set search_path = public as $$
declare dname text;
begin
  if auth.uid() is null then return; end if;
  select left(coalesce(nullif(split_part(u.email, '@', 1), ''), 'Miembro de Cupido'), 60) into dname
    from auth.users u where u.id = auth.uid();
  if dname is null then return; end if;

  insert into public.profiles as p (id, email, display_name, bio)
  select auth.uid(), u.email, dname, 'Perfil de Cupido Leudy ❤️'
    from auth.users u where u.id = auth.uid()
  on conflict (id) do update set
    email = coalesce(p.email, excluded.email),
    display_name = case when nullif(btrim(coalesce(p.display_name, '')), '') is null then excluded.display_name else p.display_name end,
    bio = case when nullif(btrim(coalesce(p.bio, '')), '') is null then excluded.bio else p.bio end;

  insert into public.creator_profiles as c (id, display_name)
  values (auth.uid(), dname)
  on conflict (id) do update set
    display_name = case when nullif(btrim(coalesce(c.display_name, '')), '') is null then excluded.display_name else c.display_name end;

  insert into public.user_credits (user_id, balance, daily_reset_at)
  values (auth.uid(), 500, now())
  on conflict (user_id) do nothing;
end;
$$;

revoke execute on function public.cupido_adapt_legacy_profile() from public, anon;
grant execute on function public.cupido_adapt_legacy_profile() to authenticated;

update public.profiles p
set display_name = split_part(u.email, '@', 1), email = coalesce(p.email, u.email)
from auth.users u
where u.id = p.id and nullif(btrim(coalesce(p.display_name, '')), '') is null;

update public.creator_profiles c
set display_name = split_part(u.email, '@', 1)
from auth.users u
where u.id = c.id and nullif(btrim(coalesce(c.display_name, '')), '') is null;

insert into public.user_credits (user_id, balance, daily_reset_at)
select u.id, 500, now() from auth.users u
where not exists (select 1 from public.user_credits uc where uc.user_id = u.id);

update public.user_credits uc
set balance = 500
where uc.balance < 500
  and not exists (select 1 from public.paypal_orders po where po.user_id = uc.user_id and po.status = 'captured')
  and not public.has_role(uc.user_id, 'admin')
  and not public.has_role(uc.user_id, 'admin_supremo');

insert into public.user_roles (user_id, role)
select u.id, 'admin' from auth.users u
where lower(coalesce(u.email, '')) = 'leudyfeliz81@gmail.com'
on conflict do nothing;

update public.site_settings
set songs_enabled = false, covers_enabled = false, videos_enabled = false
where id = 1;

create or replace function public.cupido_send_gift(
  _receiver uuid, _gift_id text, _credits integer, _cash_value numeric
)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if _receiver is null or _receiver = auth.uid() then raise exception 'INVALID_RECEIVER'; end if;
  if not exists (
    select 1 from public.cupido_gifts
      where id = _gift_id and credits = _credits and cash = _cash_value
  ) then raise exception 'INVALID_GIFT'; end if;
  if not public.has_role(auth.uid(), 'admin') and not public.has_role(auth.uid(), 'admin_supremo') then
    if _credits > 100
       and not coalesce((select has_purchased from public.profiles where id = auth.uid()), false)
       and not exists (select 1 from public.paypal_orders where user_id = auth.uid() and status = 'captured') then
      raise exception 'PURCHASE_REQUIRED';
    end if;
    update public.user_credits set balance = balance - _credits, updated_at = now()
      where user_id = auth.uid() and balance >= _credits;
    if not found then raise exception 'INSUFFICIENT_CREDITS'; end if;
    insert into public.credit_transactions (user_id, delta, reason)
      values (auth.uid(), -_credits, 'Regalo enviado en Cupido Leudy');
  end if;
  insert into public.cupido_balances (user_id, balance) values (_receiver, _cash_value)
    on conflict (user_id) do update set balance = public.cupido_balances.balance + _cash_value, updated_at = now();
  insert into public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
    values (auth.uid(), _receiver, _gift_id, _credits, _cash_value) returning id into gid;
  insert into public.notifications (user_id, title, body, kind, actor_id, target_id)
    values (_receiver, 'Recibiste un regalo ❤️', 'El valor de tu regalo ya está disponible como saldo retirable.', 'gift', auth.uid(), _receiver);
  return gid;
end;
$$;

create or replace function public.cupido_send_live_gift(
  _room uuid, _receiver uuid, _gift_id text, _credits integer, _cash_value numeric
)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (
    select 1 from public.cupido_live_rooms
      where id = _room and is_live = true and host_id = _receiver
  ) then raise exception 'INVALID_LIVE_ROOM'; end if;
  if not exists (
    select 1 from public.cupido_gifts
      where id = _gift_id and credits = _credits and cash = _cash_value
  ) then raise exception 'INVALID_GIFT'; end if;
  if not public.has_role(auth.uid(), 'admin') and not public.has_role(auth.uid(), 'admin_supremo') then
    if _credits > 100
       and not coalesce((select has_purchased from public.profiles where id = auth.uid()), false)
       and not exists (select 1 from public.paypal_orders where user_id = auth.uid() and status = 'captured') then
      raise exception 'PURCHASE_REQUIRED';
    end if;
    update public.user_credits set balance = balance - _credits, updated_at = now()
      where user_id = auth.uid() and balance >= _credits;
    if not found then raise exception 'INSUFFICIENT_CREDITS'; end if;
    insert into public.credit_transactions (user_id, delta, reason)
      values (auth.uid(), -_credits, 'Regalo en vivo en Cupido Leudy');
  end if;
  insert into public.cupido_balances (user_id, balance) values (_receiver, _cash_value)
    on conflict (user_id) do update set balance = public.cupido_balances.balance + _cash_value, updated_at = now();
  insert into public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
    values (auth.uid(), _receiver, _gift_id, _credits, _cash_value) returning id into gid;
  insert into public.notifications (user_id, title, body, kind, actor_id, target_id)
    values (_receiver, 'Recibiste un regalo durante tu Live 🎁', 'Tu regalo ya es saldo retirable.', 'live_gift', auth.uid(), _room);
  return gid;
end;
$$;

create or replace function public.cupido_start_call(_callee uuid, _mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cost integer; cid uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if _callee is null or _callee = auth.uid() then raise exception 'INVALID_CALLEE'; end if;
  cost := case when _mode = 'hot' then 100 else 50 end;
  if not public.has_role(auth.uid(), 'admin') and not public.has_role(auth.uid(), 'admin_supremo') then
    if not coalesce((select has_purchased from public.profiles where id = auth.uid()), false)
       and not exists (select 1 from public.paypal_orders where user_id = auth.uid() and status = 'captured') then
      raise exception 'PURCHASE_REQUIRED';
    end if;
    perform public.consume_credits(cost, 'Llamada ' || _mode || ' en Cupido Leudy');
  else
    cost := 0;
  end if;
  insert into public.cupido_calls (caller_id, callee_id, mode, credits_spent)
    values (auth.uid(), _callee, _mode, cost) returning id into cid;
  return cid;
end;
$$;

grant execute on function public.cupido_send_gift(uuid, text, integer, numeric) to authenticated;
grant execute on function public.cupido_send_live_gift(uuid, uuid, text, integer, numeric) to authenticated;
grant execute on function public.cupido_start_call(uuid, text) to authenticated;
