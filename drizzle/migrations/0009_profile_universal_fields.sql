-- Perfil universal: columnas compartidas por todos los usuarios autenticados.
-- Las escrituras se hacen desde el cliente con supabase.from(...).upsert/update(...).eq("id", auth.uid()).

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists age integer,
  add column if not exists gender text,
  add column if not exists looking_for text,
  add column if not exists drinks boolean not null default false,
  add column if not exists has_kids boolean not null default false;

alter table public.creator_profiles
  add column if not exists age integer,
  add column if not exists gender text;

grant update (display_name, full_name, birth_date, country_code, avatar_url, bio, age, gender, looking_for, drinks, has_kids) on public.profiles to authenticated;
grant update (display_name, bio, avatar_url, country_code, looking_for, drinks, has_kids, age, gender) on public.creator_profiles to authenticated;

-- Recompensas diarias y anuncios: una fila por usuario, día y tipo de recompensa.
create table if not exists public.cupido_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_type text not null,
  claim_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reward_type, claim_key)
);

alter table public.cupido_reward_claims enable row level security;

drop policy if exists "reward claims are own" on public.cupido_reward_claims;
create policy "reward claims are own"
  on public.cupido_reward_claims for select
  using (auth.uid() = user_id);

grant select on public.cupido_reward_claims to authenticated;
