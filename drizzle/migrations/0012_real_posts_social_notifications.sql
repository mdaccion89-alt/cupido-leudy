alter table public.cupido_posts
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists dislikes_count integer not null default 0,
  add column if not exists comments_count integer not null default 0,
  add column if not exists saves_count integer not null default 0,
  add column if not exists views_count integer not null default 0;

update public.cupido_posts
   set media_url = coalesce(media_url, media_path),
       media_type = coalesce(media_type, case when kind = 'video' then 'video' else 'image' end)
 where media_url is null or media_type is null;

alter table public.payment_settings
  add column if not exists business_name text,
  add column if not exists paypal_business_name text,
  add column if not exists admin_paypal_email text,
  add column if not exists paypal_client_id text,
  add column if not exists paypal_secret text,
  add column if not exists paypal_mode text not null default 'live';

alter table public.app_settings
  add column if not exists business_name text,
  add column if not exists admin_paypal_email text,
  add column if not exists paypal_client_id text,
  add column if not exists paypal_secret text,
  add column if not exists paypal_mode text not null default 'live';

create table if not exists public.cupido_post_dislikes (
  post_id uuid not null references public.cupido_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.cupido_post_saves (
  post_id uuid not null references public.cupido_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.cupido_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.cupido_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists cupido_post_dislikes_user_idx on public.cupido_post_dislikes (user_id);
create index if not exists cupido_post_saves_user_idx on public.cupido_post_saves (user_id);
create index if not exists cupido_post_comments_post_idx on public.cupido_post_comments (post_id, created_at);

alter table public.cupido_post_dislikes enable row level security;
alter table public.cupido_post_saves enable row level security;
alter table public.cupido_post_comments enable row level security;

grant select on public.cupido_post_dislikes, public.cupido_post_saves, public.cupido_post_comments to anon, authenticated;
grant insert, delete on public.cupido_post_dislikes, public.cupido_post_saves, public.cupido_post_comments to authenticated;

drop policy if exists "cupido post dislikes read" on public.cupido_post_dislikes;
create policy "cupido post dislikes read" on public.cupido_post_dislikes
  for select to anon, authenticated using (true);
drop policy if exists "cupido post dislikes insert" on public.cupido_post_dislikes;
create policy "cupido post dislikes insert" on public.cupido_post_dislikes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "cupido post dislikes delete" on public.cupido_post_dislikes;
create policy "cupido post dislikes delete" on public.cupido_post_dislikes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "cupido post saves read" on public.cupido_post_saves;
create policy "cupido post saves read" on public.cupido_post_saves
  for select to anon, authenticated using (true);
drop policy if exists "cupido post saves insert" on public.cupido_post_saves;
create policy "cupido post saves insert" on public.cupido_post_saves
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "cupido post saves delete" on public.cupido_post_saves;
create policy "cupido post saves delete" on public.cupido_post_saves
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "cupido post comments read" on public.cupido_post_comments;
create policy "cupido post comments read" on public.cupido_post_comments
  for select to anon, authenticated using (true);
drop policy if exists "cupido post comments insert" on public.cupido_post_comments;
create policy "cupido post comments insert" on public.cupido_post_comments
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "cupido post comments delete" on public.cupido_post_comments;
create policy "cupido post comments delete" on public.cupido_post_comments
  for delete to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "cupido notifications insert own actor" on public.notifications;
create policy "cupido notifications insert own actor" on public.notifications
  for insert to authenticated with check (actor_id is null or actor_id = auth.uid());

create or replace function public.cupido_create_notification(
  p_user uuid,
  p_title text,
  p_body text,
  p_kind text,
  p_actor uuid default null,
  p_target uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return;
  end if;
  if p_actor is not null and (auth.uid() is null or p_actor <> auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_actor is not null and p_actor = p_user then
    return;
  end if;
  if exists (
    select 1 from public.notifications
     where user_id = p_user
       and kind = p_kind
       and actor_id is not distinct from p_actor
       and target_id is not distinct from p_target
       and created_at > now() - interval '1 hour'
  ) then
    return;
  end if;
  insert into public.notifications (user_id, title, body, kind, actor_id, target_id)
  values (p_user, left(p_title, 160), left(p_body, 400), p_kind, p_actor, p_target);
end;
$$;

create or replace function public.cupido_toggle_post_dislike(_post uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select exists(
    select 1 from public.cupido_post_dislikes where post_id = _post and user_id = auth.uid()
  ) into v_exists;
  if v_exists then
    delete from public.cupido_post_dislikes where post_id = _post and user_id = auth.uid();
    return false;
  end if;
  insert into public.cupido_post_dislikes (post_id, user_id) values (_post, auth.uid());
  return true;
end;
$$;

create or replace function public.cupido_toggle_post_save(_post uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select exists(
    select 1 from public.cupido_post_saves where post_id = _post and user_id = auth.uid()
  ) into v_exists;
  if v_exists then
    delete from public.cupido_post_saves where post_id = _post and user_id = auth.uid();
    return false;
  end if;
  insert into public.cupido_post_saves (post_id, user_id) values (_post, auth.uid());
  return true;
end;
$$;

create or replace function public.cupido_register_post_view(_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cupido_posts set views_count = views_count + 1 where id = _post;
end;
$$;

create or replace function public.cupido_post_dislikes_count_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.cupido_posts
       set dislikes_count = (select count(*) from public.cupido_post_dislikes where post_id = old.post_id)
     where id = old.post_id;
    return old;
  end if;
  update public.cupido_posts
     set dislikes_count = (select count(*) from public.cupido_post_dislikes where post_id = new.post_id)
   where id = new.post_id;
  return new;
end;
$$;

create or replace function public.cupido_post_saves_count_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.cupido_posts
       set saves_count = (select count(*) from public.cupido_post_saves where post_id = old.post_id)
     where id = old.post_id;
    return old;
  end if;
  update public.cupido_posts
     set saves_count = (select count(*) from public.cupido_post_saves where post_id = new.post_id)
   where id = new.post_id;
  return new;
end;
$$;

create or replace function public.cupido_post_comments_count_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.cupido_posts
       set comments_count = (select count(*) from public.cupido_post_comments where post_id = old.post_id)
     where id = old.post_id;
    return old;
  end if;
  update public.cupido_posts
     set comments_count = (select count(*) from public.cupido_post_comments where post_id = new.post_id)
   where id = new.post_id;
  return new;
end;
$$;

drop trigger if exists cupido_post_dislikes_count on public.cupido_post_dislikes;
create trigger cupido_post_dislikes_count
after insert or delete on public.cupido_post_dislikes
for each row execute function public.cupido_post_dislikes_count_sync();

drop trigger if exists cupido_post_saves_count on public.cupido_post_saves;
create trigger cupido_post_saves_count
after insert or delete on public.cupido_post_saves
for each row execute function public.cupido_post_saves_count_sync();

drop trigger if exists cupido_post_comments_count on public.cupido_post_comments;
create trigger cupido_post_comments_count
after insert or delete on public.cupido_post_comments
for each row execute function public.cupido_post_comments_count_sync();

revoke all on function public.cupido_create_notification(uuid, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.cupido_toggle_post_dislike(uuid) from public, anon;
revoke all on function public.cupido_toggle_post_save(uuid) from public, anon;
revoke all on function public.cupido_register_post_view(uuid) from public, anon;
grant execute on function public.cupido_create_notification(uuid, text, text, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.cupido_toggle_post_dislike(uuid) to authenticated, service_role;
grant execute on function public.cupido_toggle_post_save(uuid) to authenticated, service_role;
grant execute on function public.cupido_register_post_view(uuid) to authenticated, anon, service_role;
