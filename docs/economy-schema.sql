-- AI Werewolf authenticated economy contract.
-- DECLARATIVE ONLY: this file is not evidence that any production schema exists.
-- Review and execute manually according to docs/economy-deployment.md.

begin;

-- Existing prerequisite: public.game_records from docs/supabase-init.sql.
-- Those rows and their result are client-writable historical display data and
-- are NEVER authoritative for rewards. Only economy_gameplay_eligibility below
-- is the server-authored completion/outcome fact.
create unique index if not exists economy_game_records_owner_id_uq
  on public.game_records (user_id, id);

create table if not exists public.economy_wallets (
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('coins', 'crystals')),
  balance integer not null default 0 check (balance between 0 and 2000000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

create table if not exists public.economy_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (
    char_length(idempotency_key) between 16 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
  ),
  action text not null check (action in (
    'claim_check_in', 'finish_onboarding', 'claim_gameplay_reward',
    'unlock_skin', 'equip_skin'
  )),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key),
  check (
    (status = 'pending' and result is null and completed_at is null)
    or (status = 'completed' and result is not null and completed_at is not null)
  )
);

create table if not exists public.economy_skin_catalog (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_:-]{0,63}$'),
  name text not null check (char_length(name) between 1 and 80),
  item_kind text not null check (item_kind in ('skin', 'avatar_frame')),
  tier text not null check (tier in ('basic', 'premium', 'common', 'rare')),
  acquisition text not null check (acquisition in ('purchase', 'milestone')),
  currency text check (currency in ('coins', 'crystals')),
  price integer not null check (price between 0 and 1000000),
  asset_key text not null check (asset_key ~ '^[a-z0-9][a-z0-9/_-]{0,127}$'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      acquisition = 'purchase'
      and item_kind = 'skin'
      and (
        (tier = 'basic' and currency = 'coins' and price in (800, 1400, 2200, 3200))
        or (tier = 'premium' and currency = 'crystals' and price in (20, 40, 80))
      )
    )
    or (
      acquisition = 'milestone'
      and currency is null
      and price = 0
    )
  )
);

-- Server-owned catalog: all entries are cosmetic assets only.  No gameplay
-- modifier, reward multiplier or hidden-authority column exists.
insert into public.economy_skin_catalog
  (id, name, item_kind, tier, acquisition, currency, price, asset_key, active)
values
  ('mist-wanderer', 'Mist Wanderer', 'skin', 'basic', 'purchase', 'coins', 800, 'skins/mist-wanderer', true),
  ('bamboo-vigil', 'Bamboo Vigil', 'skin', 'basic', 'purchase', 'coins', 1400, 'skins/bamboo-vigil', true),
  ('tidal-swordsman', 'Tidal Swordsman', 'skin', 'basic', 'purchase', 'coins', 2200, 'skins/tidal-swordsman', true),
  ('moonlit-crane', 'Moonlit Crane', 'skin', 'basic', 'purchase', 'coins', 3200, 'skins/moonlit-crane', true),
  ('jade-moon-oath', 'Jade Moon Oath', 'skin', 'premium', 'purchase', 'crystals', 20, 'skins/jade-moon-oath', true),
  ('tidebreaker-vow', 'Tidebreaker Vow', 'skin', 'premium', 'purchase', 'crystals', 40, 'skins/tidebreaker-vow', true),
  ('crimson-lotus-shadow', 'Crimson Lotus Shadow', 'skin', 'premium', 'purchase', 'crystals', 80, 'skins/crimson-lotus-shadow', true),
  ('avatar-frame:ink-ring', 'Ink Ring Avatar Frame', 'avatar_frame', 'common', 'milestone', null, 0, 'frames/ink-ring', true),
  ('avatar-frame:crimson-moon', 'Crimson Moon Avatar Frame', 'avatar_frame', 'rare', 'milestone', null, 0, 'frames/crimson-moon', true)
on conflict (id) do update set
  name = excluded.name,
  item_kind = excluded.item_kind,
  tier = excluded.tier,
  acquisition = excluded.acquisition,
  currency = excluded.currency,
  price = excluded.price,
  asset_key = excluded.asset_key,
  active = excluded.active,
  updated_at = now();

-- Re-running this candidate over an earlier local draft must not leave the
-- replaced catalog visible. No production execution is asserted here.
update public.economy_skin_catalog
set active = false, updated_at = now()
where id in (
  'charcoal-cloak', 'moonlit-villager', 'silver-seer', 'alpha-shadow',
  'obsidian-veil', 'eclipse-wolf', 'village-sovereign',
  'streak-frame-common', 'streak-basic-skin', 'streak-frame-rare'
);

create table if not exists public.economy_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.economy_skin_catalog(id),
  source text not null check (source in ('purchase', 'check_in_milestone')),
  acquired_at timestamptz not null default now(),
  receipt_id uuid not null references public.economy_mutation_receipts(id),
  primary key (user_id, item_id)
);

create table if not exists public.economy_player_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  equipped_skin_id text,
  check_in_streak integer not null default 0 check (check_in_streak between 0 and 1000000),
  last_check_in_date date,
  onboarding_completed_at timestamptz,
  gameplay_server_date date,
  gameplay_claims_today integer not null default 0 check (gameplay_claims_today between 0 and 5),
  gameplay_coins_today integer not null default 0 check (gameplay_coins_today between 0 and 200),
  updated_at timestamptz not null default now(),
  constraint economy_equipped_owned_fk
    foreign key (user_id, equipped_skin_id)
    references public.economy_inventory (user_id, item_id)
    deferrable initially immediate
);

create table if not exists public.economy_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('coins', 'crystals')),
  amount integer not null check (amount between -1000000 and 1000000 and amount <> 0),
  balance_after integer not null check (balance_after between 0 and 2000000000),
  event_type text not null check (event_type in (
    'check_in', 'check_in_milestone', 'onboarding', 'gameplay_reward', 'skin_unlock'
  )),
  reference_id text not null check (char_length(reference_id) between 1 and 128),
  receipt_id uuid not null references public.economy_mutation_receipts(id),
  created_at timestamptz not null default now()
);

create table if not exists public.economy_check_in_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  server_date date not null,
  streak_day integer not null check (streak_day between 1 and 1000000),
  coins_awarded integer not null check (coins_awarded between 30 and 550),
  crystals_awarded integer not null default 0 check (crystals_awarded in (0, 3, 8)),
  receipt_id uuid not null unique references public.economy_mutation_receipts(id),
  created_at timestamptz not null default now(),
  primary key (user_id, server_date)
);

-- Trusted completion/outcome boundary. There is deliberately no browser grant,
-- public authoring RPC, trigger from game_records, or client-submittable flag.
-- Until a separately approved authoritative server writer inserts a row,
-- gameplay reward claims fail closed even when a client-created game_records
-- row says WIN/LOSE.
create table if not exists public.economy_gameplay_eligibility (
  user_id uuid not null,
  game_record_id uuid not null,
  outcome text not null check (outcome in ('WIN', 'LOSE')),
  completed_at timestamptz not null,
  source_event_id text not null unique check (char_length(source_event_id) between 16 and 128),
  created_at timestamptz not null default now(),
  primary key (user_id, game_record_id),
  foreign key (user_id) references auth.users(id) on delete cascade,
  foreign key (user_id, game_record_id)
    references public.game_records(user_id, id) on delete cascade
);

create table if not exists public.economy_gameplay_claims (
  user_id uuid not null,
  game_record_id uuid not null,
  server_date date not null,
  reward_coins integer not null check (reward_coins between 1 and 100),
  receipt_id uuid not null unique references public.economy_mutation_receipts(id),
  created_at timestamptz not null default now(),
  primary key (user_id, game_record_id),
  foreign key (user_id) references auth.users(id) on delete cascade,
  foreign key (user_id, game_record_id)
    references public.economy_gameplay_eligibility(user_id, game_record_id) on delete cascade
);

create index if not exists economy_ledger_user_page_idx
  on public.economy_ledger (user_id, created_at desc, id desc);
create index if not exists economy_inventory_user_acquired_idx
  on public.economy_inventory (user_id, acquired_at desc);
create index if not exists economy_receipts_user_created_idx
  on public.economy_mutation_receipts (user_id, created_at desc);
create index if not exists economy_gameplay_daily_idx
  on public.economy_gameplay_claims (user_id, server_date, created_at);
create index if not exists economy_eligibility_completed_idx
  on public.economy_gameplay_eligibility (user_id, completed_at desc);

-- Append-only means even privileged accidental UPDATE/DELETE statements fail.
create or replace function public.economy_forbid_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'ECONOMY_LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

drop trigger if exists economy_ledger_append_only on public.economy_ledger;
create trigger economy_ledger_append_only
before update or delete on public.economy_ledger
for each row execute function public.economy_forbid_ledger_mutation();

-- RLS: authenticated users may read only their own records.  Direct writes are
-- not granted. Catalog reads expose only active entries and named public fields.
alter table public.economy_wallets enable row level security;
alter table public.economy_mutation_receipts enable row level security;
alter table public.economy_skin_catalog enable row level security;
alter table public.economy_inventory enable row level security;
alter table public.economy_player_state enable row level security;
alter table public.economy_ledger enable row level security;
alter table public.economy_check_in_claims enable row level security;
alter table public.economy_gameplay_eligibility enable row level security;
alter table public.economy_gameplay_claims enable row level security;

drop policy if exists economy_wallet_read_own on public.economy_wallets;
create policy economy_wallet_read_own on public.economy_wallets
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_receipt_read_own on public.economy_mutation_receipts;
create policy economy_receipt_read_own on public.economy_mutation_receipts
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_catalog_read_active on public.economy_skin_catalog;
create policy economy_catalog_read_active on public.economy_skin_catalog
for select to authenticated using (active is true);
drop policy if exists economy_inventory_read_own on public.economy_inventory;
create policy economy_inventory_read_own on public.economy_inventory
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_state_read_own on public.economy_player_state;
create policy economy_state_read_own on public.economy_player_state
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_ledger_read_own on public.economy_ledger;
create policy economy_ledger_read_own on public.economy_ledger
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_check_in_read_own on public.economy_check_in_claims;
create policy economy_check_in_read_own on public.economy_check_in_claims
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists economy_gameplay_read_own on public.economy_gameplay_claims;
create policy economy_gameplay_read_own on public.economy_gameplay_claims
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.economy_wallets, public.economy_mutation_receipts,
  public.economy_skin_catalog, public.economy_inventory,
  public.economy_player_state, public.economy_ledger,
  public.economy_check_in_claims, public.economy_gameplay_eligibility,
  public.economy_gameplay_claims
  from public, anon, authenticated;
grant select (user_id, currency, balance, updated_at)
  on public.economy_wallets to authenticated;
grant select (id, user_id, idempotency_key, action, status, result, created_at, completed_at)
  on public.economy_mutation_receipts to authenticated;
grant select (id, name, item_kind, tier, acquisition, currency, price, asset_key, active)
  on public.economy_skin_catalog to authenticated;
grant select on public.economy_inventory, public.economy_player_state,
  public.economy_ledger, public.economy_check_in_claims,
  public.economy_gameplay_claims to authenticated;

create or replace function public.economy_begin_receipt(
  p_action text,
  p_idempotency_key text,
  p_canonical_payload jsonb
)
returns table (receipt_id uuid, replayed boolean, stored_result jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted_id uuid;
  v_existing public.economy_mutation_receipts%rowtype;
begin
  if v_user_id is null then
    raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_action not in (
    'claim_check_in', 'finish_onboarding', 'claim_gameplay_reward',
    'unlock_skin', 'equip_skin'
  ) or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 16 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    or jsonb_typeof(p_canonical_payload) <> 'object' then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;

  insert into public.economy_mutation_receipts
    (user_id, idempotency_key, action, canonical_payload)
  values (v_user_id, p_idempotency_key, p_action, p_canonical_payload)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query select v_inserted_id, false, null::jsonb;
    return;
  end if;

  -- FOR UPDATE waits for a concurrent first request to commit. A rolled-back
  -- first request leaves no row, so a subsequent retry can create it cleanly.
  select * into v_existing
  from public.economy_mutation_receipts
  where user_id = v_user_id and idempotency_key = p_idempotency_key
  for update;

  if not found or v_existing.action <> p_action
    or v_existing.canonical_payload <> p_canonical_payload then
    raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_existing.status <> 'completed' or v_existing.result is null then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;

  return query select v_existing.id, true, v_existing.result;
end;
$$;

create or replace function public.economy_ensure_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001';
  end if;
  insert into public.economy_wallets (user_id, currency, balance)
  values (p_user_id, 'coins', 0), (p_user_id, 'crystals', 0)
  on conflict (user_id, currency) do nothing;
  insert into public.economy_player_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.economy_wallet_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'coins', coalesce(max(balance) filter (where currency = 'coins'), 0),
    'crystals', coalesce(max(balance) filter (where currency = 'crystals'), 0)
  )
  from public.economy_wallets
  where user_id = p_user_id and p_user_id = auth.uid();
$$;

create or replace function public.economy_apply_wallet_delta(
  p_user_id uuid,
  p_currency text,
  p_amount integer,
  p_event_type text,
  p_reference_id text,
  p_receipt_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_balance integer;
begin
  if p_user_id is null or p_user_id <> auth.uid()
    or p_currency not in ('coins', 'crystals')
    or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;

  select balance into v_balance
  from public.economy_wallets
  where user_id = p_user_id and currency = p_currency
  for update;
  if not found then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'ECONOMY_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;
  if v_balance + p_amount > 2000000000 then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;

  update public.economy_wallets
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id and currency = p_currency
  returning balance into v_balance;

  insert into public.economy_ledger
    (user_id, currency, amount, balance_after, event_type, reference_id, receipt_id)
  values
    (p_user_id, p_currency, p_amount, v_balance, p_event_type, p_reference_id, p_receipt_id);
  return v_balance;
end;
$$;

create or replace function public.economy_complete_receipt(
  p_user_id uuid,
  p_receipt_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or p_user_id <> auth.uid() or jsonb_typeof(p_result) <> 'object' then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;
  update public.economy_mutation_receipts
  set status = 'completed', result = p_result, completed_at = now()
  where id = p_receipt_id and user_id = p_user_id and status = 'pending';
  if not found then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;
  return p_result;
end;
$$;

create or replace function public.economy_claim_check_in(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt record;
  v_state public.economy_player_state%rowtype;
  v_server_date date := (current_timestamp at time zone 'UTC')::date;
  v_streak integer;
  v_cycle_day integer;
  v_coins integer;
  v_crystals integer := 0;
  v_unlocked jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_receipt from public.economy_begin_receipt(
    'claim_check_in', p_idempotency_key, '{}'::jsonb
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  select * into v_state from public.economy_player_state
  where user_id = v_user_id for update;
  if v_state.last_check_in_date = v_server_date then
    raise exception 'ECONOMY_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;
  v_streak := case
    when v_state.last_check_in_date = v_server_date - 1 then v_state.check_in_streak + 1
    else 1
  end;
  v_cycle_day := ((v_streak - 1) % 7) + 1;
  v_coins := (array[30, 40, 50, 60, 70, 100, 250])[v_cycle_day];

  if v_streak = 7 then
    insert into public.economy_inventory (user_id, item_id, source, receipt_id)
    values (v_user_id, 'avatar-frame:ink-ring', 'check_in_milestone', v_receipt.receipt_id)
    on conflict (user_id, item_id) do nothing;
    v_unlocked := v_unlocked || jsonb_build_array('avatar-frame:ink-ring');
  elsif v_streak = 14 then
    v_coins := v_coins + 300;
  elsif v_streak = 30 then
    v_crystals := 3;
  elsif v_streak = 60 then
    insert into public.economy_inventory (user_id, item_id, source, receipt_id)
    values (v_user_id, 'mist-wanderer', 'check_in_milestone', v_receipt.receipt_id)
    on conflict (user_id, item_id) do nothing;
    v_unlocked := v_unlocked || jsonb_build_array('mist-wanderer');
  elsif v_streak = 90 then
    v_crystals := 8;
    insert into public.economy_inventory (user_id, item_id, source, receipt_id)
    values (v_user_id, 'avatar-frame:crimson-moon', 'check_in_milestone', v_receipt.receipt_id)
    on conflict (user_id, item_id) do nothing;
    v_unlocked := v_unlocked || jsonb_build_array('avatar-frame:crimson-moon');
  end if;

  perform public.economy_apply_wallet_delta(
    v_user_id, 'coins', v_coins,
    case when v_streak = 14 then 'check_in_milestone' else 'check_in' end,
    v_server_date::text, v_receipt.receipt_id
  );
  if v_crystals > 0 then
    perform public.economy_apply_wallet_delta(
      v_user_id, 'crystals', v_crystals, 'check_in_milestone',
      'streak-' || v_streak::text, v_receipt.receipt_id
    );
  end if;

  update public.economy_player_state
  set check_in_streak = v_streak, last_check_in_date = v_server_date, updated_at = now()
  where user_id = v_user_id;
  insert into public.economy_check_in_claims
    (user_id, server_date, streak_day, coins_awarded, crystals_awarded, receipt_id)
  values (v_user_id, v_server_date, v_streak, v_coins, v_crystals, v_receipt.receipt_id);

  v_result := jsonb_build_object(
    'action', 'claim_check_in', 'serverDate', v_server_date,
    'streak', v_streak, 'cycleDay', v_cycle_day,
    'awardedCoins', v_coins, 'awardedCrystals', v_crystals,
    'unlockedItemIds', v_unlocked,
    'wallet', public.economy_wallet_snapshot(v_user_id)
  );
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

create or replace function public.economy_finish_onboarding(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt record;
  v_completed_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_receipt from public.economy_begin_receipt(
    'finish_onboarding', p_idempotency_key, '{}'::jsonb
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  select onboarding_completed_at into v_completed_at
  from public.economy_player_state where user_id = v_user_id for update;
  if v_completed_at is not null then
    raise exception 'ECONOMY_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;
  perform public.economy_apply_wallet_delta(
    v_user_id, 'coins', 200, 'onboarding', 'onboarding', v_receipt.receipt_id
  );
  update public.economy_player_state
  set onboarding_completed_at = now(), updated_at = now()
  where user_id = v_user_id
  returning onboarding_completed_at into v_completed_at;
  v_result := jsonb_build_object(
    'action', 'finish_onboarding', 'awardedCoins', 200,
    'completedAt', v_completed_at,
    'wallet', public.economy_wallet_snapshot(v_user_id)
  );
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

create or replace function public.economy_claim_gameplay_reward(
  p_idempotency_key text,
  p_game_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt record;
  v_eligibility public.economy_gameplay_eligibility%rowtype;
  v_state public.economy_player_state%rowtype;
  v_server_date date := (current_timestamp at time zone 'UTC')::date;
  v_reward integer;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_receipt from public.economy_begin_receipt(
    'claim_gameplay_reward', p_idempotency_key,
    jsonb_build_object('gameRecordId', p_game_record_id)
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  select * into v_eligibility from public.economy_gameplay_eligibility
  where game_record_id = p_game_record_id and user_id = v_user_id
    and completed_at <= now()
  for share;
  if not found then
    raise exception 'ECONOMY_REWARD_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_state from public.economy_player_state
  where user_id = v_user_id for update;
  if v_state.gameplay_server_date is distinct from v_server_date then
    update public.economy_player_state
    set gameplay_server_date = v_server_date,
        gameplay_claims_today = 0,
        gameplay_coins_today = 0,
        updated_at = now()
    where user_id = v_user_id
    returning * into v_state;
  end if;
  if v_state.gameplay_claims_today >= 5 or v_state.gameplay_coins_today >= 200 then
    raise exception 'ECONOMY_DAILY_LIMIT' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.economy_gameplay_claims
    where user_id = v_user_id and game_record_id = p_game_record_id
  ) then
    raise exception 'ECONOMY_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  -- Fixed server rules: 40 completion + 20 win + 40 first UTC-day game,
  -- bounded by both five claims and 200 Coins per server UTC day.
  v_reward := 40
    + case when v_eligibility.outcome = 'WIN' then 20 else 0 end
    + case when v_state.gameplay_claims_today = 0 then 40 else 0 end;
  v_reward := least(v_reward, 200 - v_state.gameplay_coins_today);
  if v_reward <= 0 then raise exception 'ECONOMY_DAILY_LIMIT' using errcode = 'P0001'; end if;

  insert into public.economy_gameplay_claims
    (user_id, game_record_id, server_date, reward_coins, receipt_id)
  values (v_user_id, p_game_record_id, v_server_date, v_reward, v_receipt.receipt_id);
  perform public.economy_apply_wallet_delta(
    v_user_id, 'coins', v_reward, 'gameplay_reward',
    p_game_record_id::text, v_receipt.receipt_id
  );
  update public.economy_player_state
  set gameplay_claims_today = gameplay_claims_today + 1,
      gameplay_coins_today = gameplay_coins_today + v_reward,
      updated_at = now()
  where user_id = v_user_id;

  v_result := jsonb_build_object(
    'action', 'claim_gameplay_reward', 'gameRecordId', p_game_record_id,
    'serverDate', v_server_date, 'awardedCoins', v_reward,
    'wallet', public.economy_wallet_snapshot(v_user_id)
  );
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

create or replace function public.economy_unlock_skin(
  p_idempotency_key text,
  p_skin_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt record;
  v_item public.economy_skin_catalog%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_receipt from public.economy_begin_receipt(
    'unlock_skin', p_idempotency_key, jsonb_build_object('skinId', p_skin_id)
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  -- The state-row lock serializes concurrent unlocks even before an inventory
  -- row exists, preventing two different keys from charging the same item.
  perform 1 from public.economy_player_state where user_id = v_user_id for update;
  select * into v_item from public.economy_skin_catalog
  where id = p_skin_id and active is true and item_kind = 'skin'
    and acquisition = 'purchase'
    and ((tier = 'basic' and currency = 'coins' and price in (800, 1400, 2200, 3200))
      or (tier = 'premium' and currency = 'crystals' and price in (20, 40, 80)))
  for share;
  if not found then raise exception 'ECONOMY_NOT_FOUND' using errcode = 'P0001'; end if;
  if exists (
    select 1 from public.economy_inventory
    where user_id = v_user_id and item_id = p_skin_id
  ) then
    raise exception 'ECONOMY_ALREADY_OWNED' using errcode = 'P0001';
  end if;

  perform public.economy_apply_wallet_delta(
    v_user_id, v_item.currency, -v_item.price, 'skin_unlock', p_skin_id, v_receipt.receipt_id
  );
  insert into public.economy_inventory (user_id, item_id, source, receipt_id)
  values (v_user_id, p_skin_id, 'purchase', v_receipt.receipt_id);

  v_result := jsonb_build_object(
    'action', 'unlock_skin', 'skinId', p_skin_id,
    'chargedCurrency', v_item.currency, 'chargedAmount', v_item.price,
    'wallet', public.economy_wallet_snapshot(v_user_id)
  );
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

create or replace function public.economy_equip_skin(
  p_idempotency_key text,
  p_skin_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt record;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_receipt from public.economy_begin_receipt(
    'equip_skin', p_idempotency_key, jsonb_build_object('skinId', p_skin_id)
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  perform 1 from public.economy_player_state where user_id = v_user_id for update;
  if not exists (
    select 1
    from public.economy_inventory inventory
    join public.economy_skin_catalog catalog on catalog.id = inventory.item_id
    where inventory.user_id = v_user_id and inventory.item_id = p_skin_id
      and catalog.item_kind = 'skin'
  ) then
    raise exception 'ECONOMY_NOT_OWNED' using errcode = 'P0001';
  end if;

  update public.economy_player_state
  set equipped_skin_id = p_skin_id, updated_at = now()
  where user_id = v_user_id;
  v_result := jsonb_build_object('action', 'equip_skin', 'equippedSkinId', p_skin_id);
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

create or replace function public.economy_get_state(
  p_ledger_limit integer default 25,
  p_ledger_cursor uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_server_date date := (current_timestamp at time zone 'UTC')::date;
  v_cursor_time timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'ECONOMY_UNAUTHORIZED' using errcode = 'P0001'; end if;
  if p_ledger_limit is null or p_ledger_limit < 1 or p_ledger_limit > 100 then
    raise exception 'ECONOMY_INVALID_STATE' using errcode = 'P0001';
  end if;
  if p_ledger_cursor is not null then
    select created_at into v_cursor_time from public.economy_ledger
    where id = p_ledger_cursor and user_id = v_user_id;
    if not found then raise exception 'ECONOMY_NOT_FOUND' using errcode = 'P0001'; end if;
  end if;

  with ledger_rows as (
    select ledger.*
    from public.economy_ledger ledger
    where ledger.user_id = v_user_id
      and (p_ledger_cursor is null or (ledger.created_at, ledger.id) < (v_cursor_time, p_ledger_cursor))
    order by ledger.created_at desc, ledger.id desc
    limit p_ledger_limit + 1
  ), ledger_page as (
    select * from ledger_rows
    order by created_at desc, id desc
    limit p_ledger_limit
  )
  select jsonb_build_object(
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'itemKind', item_kind, 'tier', tier,
        'currency', currency, 'price', price, 'assetKey', asset_key,
        'purchaseEnabled', acquisition = 'purchase'
      ) order by tier, price, id)
      from public.economy_skin_catalog where active is true
    ), '[]'::jsonb),
    'wallet', public.economy_wallet_snapshot(v_user_id),
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'itemKind', catalog.item_kind,
        'tier', catalog.tier, 'assetKey', catalog.asset_key,
        'source', inventory.source, 'acquiredAt', inventory.acquired_at
      ) order by inventory.acquired_at, catalog.id)
      from public.economy_inventory inventory
      join public.economy_skin_catalog catalog on catalog.id = inventory.item_id
      where inventory.user_id = v_user_id
    ), '[]'::jsonb),
    'equippedSkinId', (
      select equipped_skin_id from public.economy_player_state where user_id = v_user_id
    ),
    'checkIn', jsonb_build_object(
      'streak', coalesce((select check_in_streak from public.economy_player_state where user_id = v_user_id), 0),
      'lastClaimDate', (select last_check_in_date from public.economy_player_state where user_id = v_user_id),
      'serverDate', v_server_date,
      'claimedMilestoneDays', coalesce((
        select jsonb_agg(milestone.streak_day order by milestone.streak_day)
        from (
          select distinct claim.streak_day
          from public.economy_check_in_claims claim
          where claim.user_id = v_user_id
            and claim.streak_day in (7, 14, 30, 60, 90)
        ) milestone
      ), '[]'::jsonb)
    ),
    'onboarding', jsonb_build_object(
      'completed', coalesce((select onboarding_completed_at is not null from public.economy_player_state where user_id = v_user_id), false),
      'completedAt', (select onboarding_completed_at from public.economy_player_state where user_id = v_user_id)
    ),
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'currency', currency, 'amount', amount,
        'balanceAfter', balance_after, 'eventType', event_type,
        'referenceId', reference_id, 'createdAt', created_at
      ) order by created_at desc, id desc) from ledger_page
    ), '[]'::jsonb),
    'nextCursor', case when (select count(*) from ledger_rows) > p_ledger_limit
      then (select id from ledger_page order by created_at asc, id asc limit 1)
      else null end
  ) into v_result;
  return v_result;
end;
$$;

-- Only the six public contracts are callable by authenticated clients. Helper
-- functions remain private despite SECURITY DEFINER.
revoke all on function public.economy_forbid_ledger_mutation() from public, anon, authenticated;
revoke all on function public.economy_begin_receipt(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.economy_ensure_user(uuid) from public, anon, authenticated;
revoke all on function public.economy_wallet_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.economy_apply_wallet_delta(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.economy_complete_receipt(uuid, uuid, jsonb) from public, anon, authenticated;

revoke all on function public.economy_get_state(integer, uuid) from public, anon, authenticated;
revoke all on function public.economy_claim_check_in(text) from public, anon, authenticated;
revoke all on function public.economy_finish_onboarding(text) from public, anon, authenticated;
revoke all on function public.economy_claim_gameplay_reward(text, uuid) from public, anon, authenticated;
revoke all on function public.economy_unlock_skin(text, text) from public, anon, authenticated;
revoke all on function public.economy_equip_skin(text, text) from public, anon, authenticated;

grant execute on function public.economy_get_state(integer, uuid) to authenticated;
grant execute on function public.economy_claim_check_in(text) to authenticated;
grant execute on function public.economy_finish_onboarding(text) to authenticated;
grant execute on function public.economy_claim_gameplay_reward(text, uuid) to authenticated;
grant execute on function public.economy_unlock_skin(text, text) to authenticated;
grant execute on function public.economy_equip_skin(text, text) to authenticated;

commit;
