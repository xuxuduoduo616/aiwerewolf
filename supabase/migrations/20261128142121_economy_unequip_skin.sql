-- Migration: add unequip_skin action and economy_unequip_skin RPC.
begin;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.economy_mutation_receipts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%action%'
  loop
    execute format(
      'alter table public.economy_mutation_receipts drop constraint %I',
      v_constraint.conname
    );
  end loop;

  alter table public.economy_mutation_receipts
    add constraint economy_mutation_receipts_action_check
    check (action in (
      'claim_check_in', 'finish_onboarding', 'claim_gameplay_reward',
      'unlock_skin', 'equip_skin', 'unequip_skin'
    ));
end
$$;

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
    'unlock_skin', 'equip_skin', 'unequip_skin'
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

create or replace function public.economy_unequip_skin(
  p_idempotency_key text
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
    'unequip_skin', p_idempotency_key, '{}'::jsonb
  );
  if v_receipt.replayed then return v_receipt.stored_result; end if;

  perform public.economy_ensure_user(v_user_id);
  perform 1 from public.economy_player_state where user_id = v_user_id for update;

  update public.economy_player_state
  set equipped_skin_id = null, updated_at = now()
  where user_id = v_user_id;
  v_result := jsonb_build_object('action', 'unequip_skin', 'equippedSkinId', null);
  return public.economy_complete_receipt(v_user_id, v_receipt.receipt_id, v_result);
end;
$$;

revoke all on function public.economy_begin_receipt(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.economy_unequip_skin(text) from public, anon, authenticated;
grant execute on function public.economy_unequip_skin(text) to authenticated;

commit;
