-- Recompensas activas y referidos: estado real en public.profiles.
-- Las escrituras se hacen desde los server functions con el cliente service_role.

alter table public.profiles
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_daily_claim timestamptz,
  add column if not exists last_wheel_spin timestamptz,
  add column if not exists referred_by uuid references auth.users(id) on delete set null;

grant update (daily_streak, last_daily_claim, last_wheel_spin, referred_by) on public.profiles to authenticated;

-- La creación del referido también guarda el invitador en el perfil del nuevo usuario.
create or replace function public.cupido_register_referral(_referrer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referee uuid := auth.uid();
begin
  if v_referee is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if _referrer is null or _referrer = v_referee then
    return;
  end if;
  if not exists (select 1 from auth.users where id = _referrer) then
    return;
  end if;

  update public.profiles
  set referred_by = _referrer
  where id = v_referee and referred_by is null;

  insert into public.cupido_referrals (referee_id, referrer_id)
  values (v_referee, _referrer)
  on conflict (referee_id) do nothing;
end $$;
