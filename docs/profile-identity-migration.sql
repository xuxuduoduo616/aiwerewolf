-- Source-only migration artifact for TC-002.
-- Do not release the matching frontend until this migration has been applied
-- and the owner-only RLS/unique contract has been verified in the target project.

begin;

alter table public.profiles
  add column if not exists username text;

-- Normalize any values from a partially applied/manual migration first.
update public.profiles
set username = lower(btrim(username))
where username is not null;

-- Preserve every canonical valid handle, including a user-chosen value that
-- happens to look like a generated `player_<32 hex>` fallback. Only missing,
-- invalid, or duplicate rows are backfilled. Candidate selection is processed
-- serially so a preserved handle can never be overwritten or collide with a
-- generated handle; replay leaves every already-valid unique Username intact.
do $$
declare
  profile_row record;
  candidate text;
  candidate_attempt integer;
begin
  for profile_row in
    with ranked as (
      select
        id,
        username,
        row_number() over (partition by username order by id) as duplicate_rank
      from public.profiles
    )
    select id
    from ranked
    where username is null
       or username !~ '^[a-z0-9_]{3,40}$'
       or duplicate_rank > 1
    order by id
  loop
    candidate_attempt := 0;
    loop
      candidate := case
        when candidate_attempt = 0
          then 'player_' || replace(profile_row.id::text, '-', '')
        else 'player_' || md5(profile_row.id::text || ':' || candidate_attempt::text)
      end;

      exit when not exists (
        select 1
        from public.profiles as existing
        where existing.id <> profile_row.id
          and existing.username = candidate
      );
      candidate_attempt := candidate_attempt + 1;
    end loop;

    update public.profiles
    set username = candidate
    where id = profile_row.id;
  end loop;
end
$$;

-- Nickname remains physically stored in display_name. Never derive it from
-- email; legacy blank values fall back to the now-valid Username. Normalize
-- existing values before adding the length constraint so the migration is
-- safe for every pre-constraint row.
update public.profiles
set display_name = case
  when display_name is null or btrim(display_name) = '' then username
  else left(btrim(display_name), 80)
end;

alter table public.profiles
  alter column username set not null,
  alter column display_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username = lower(btrim(username)) and username ~ '^[a-z0-9_]{3,40}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_unique'
  ) then
    alter table public.profiles
      add constraint profiles_username_unique unique (username);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_display_name_check'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_check
      check (btrim(display_name) <> '' and char_length(display_name) <= 80);
  end if;
end
$$;

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "用户读取自己的档案" on public.profiles;
drop policy if exists "用户创建自己的档案" on public.profiles;
drop policy if exists "用户更新自己的档案" on public.profiles;
drop policy if exists "profiles_owner_select" on public.profiles;
drop policy if exists "profiles_owner_insert" on public.profiles;
drop policy if exists "profiles_owner_update" on public.profiles;

create policy "profiles_owner_select"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_owner_insert"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_owner_update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

commit;

-- Verification (run separately after an approved apply): confirm constraints,
-- grants, and owner allow/deny behavior with two authenticated test principals.
-- Rollback requires first rolling back the frontend. Only then may the three
-- identity constraints and username column be removed; do not drop user data as
-- part of an automatic rollback.
