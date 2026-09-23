import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GUEST_IDENTITY_STORAGE_KEY,
  guestLabel,
  isGuestPrincipalId,
  loadOrCreateGuestIdentity,
  normalizeNickname,
  resetRuntimeGuestIdentityForTests,
  validateUsername,
} from './publicIdentity';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const storage = () => {
  const values = new Map<string, string>();
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  };
};

afterEach(resetRuntimeGuestIdentityForTests);

describe('public identity contract', () => {
  it.each([
    ['', false, ''],
    ['  ', false, ''],
    ['AB', false, 'ab'],
    ['Ab_C', true, 'ab_c'],
    ['a-b', false, 'a-b'],
    ['a'.repeat(40), true, 'a'.repeat(40)],
    ['a'.repeat(41), false, 'a'.repeat(41)],
  ])('validates Username %j', (input, valid, canonical) => {
    expect(validateUsername(input)).toMatchObject({ valid, value: canonical });
  });

  it('keeps reserved-looking canonical handles consistent across client and source SQL replay', () => {
    const username = `player_${'b'.repeat(32)}`;
    const migration = readFileSync(new URL('../../docs/profile-identity-migration.sql', import.meta.url), 'utf8');
    const freshSchema = readFileSync(new URL('../../docs/supabase-init.sql', import.meta.url), 'utf8');

    expect(validateUsername(username)).toMatchObject({ valid: true, value: username });
    expect(freshSchema).toContain("username ~ '^[a-z0-9_]{3,40}$'");
    expect(migration).toContain("or username !~ '^[a-z0-9_]{3,40}$'");
    expect(migration).toContain('or duplicate_rank > 1');
    expect(migration).not.toContain("or username ~ '^player_[0-9a-f]{32}$'");
    expect(migration).toContain('and existing.username = candidate');
  });

  it('uses Username when optional Nickname is blank and bounds explicit Nickname', () => {
    expect(normalizeNickname('  ', 'Player_1')).toEqual({ value: 'player_1', valid: true, error: '' });
    expect(normalizeNickname('Village Traveler', 'player_1').value).toBe('Village Traveler');
    expect(normalizeNickname('x'.repeat(81), 'player_1').valid).toBe(false);
  });

  it('creates different namespaced UUIDv4 principals for different browser profiles', () => {
    const first = storage();
    const second = storage();
    const a = loadOrCreateGuestIdentity(first.api, () => UUID_A);
    resetRuntimeGuestIdentityForTests();
    const b = loadOrCreateGuestIdentity(second.api, () => UUID_B);
    expect(a?.id).toBe(`guest:${UUID_A}`);
    expect(b?.id).toBe(`guest:${UUID_B}`);
    expect(a?.id).not.toBe(b?.id);
    expect(isGuestPrincipalId(a?.id)).toBe(true);
    expect(a?.id).not.toBe(UUID_A);
    expect(a?.id.startsWith('@')).toBe(false);
    expect(guestLabel(a?.id ?? '')).toBe('Guest 11111111');
  });

  it('restores one browser-profile identity across re-entry', () => {
    const local = storage();
    const first = loadOrCreateGuestIdentity(local.api, () => UUID_A);
    resetRuntimeGuestIdentityForTests();
    const restored = loadOrCreateGuestIdentity(local.api, () => UUID_B);
    expect(restored).toMatchObject({ id: first?.id, persistent: true, status: 'restored' });
  });

  it('fails a corrupt envelope closed and keeps only a runtime identity', () => {
    const local = storage();
    local.values.set(GUEST_IDENTITY_STORAGE_KEY, '{bad-json');
    const result = loadOrCreateGuestIdentity(local.api, () => UUID_B);
    expect(result).toMatchObject({ id: `guest:${UUID_B}`, persistent: false, status: 'corrupt' });
    expect(local.values.get(GUEST_IDENTITY_STORAGE_KEY)).toBe('{bad-json');
  });

  it('does not reuse a formerly restored principal after its envelope becomes corrupt', () => {
    const local = storage();
    const restored = loadOrCreateGuestIdentity(local.api, () => UUID_A);
    local.values.set(GUEST_IDENTITY_STORAGE_KEY, '{bad-json');
    const fallback = loadOrCreateGuestIdentity(local.api, () => UUID_B);
    expect(fallback?.id).toBe(`guest:${UUID_B}`);
    expect(fallback?.id).not.toBe(restored?.id);
  });

  it('keeps one runtime identity when storage is unavailable', () => {
    const first = loadOrCreateGuestIdentity(null, () => UUID_A);
    const second = loadOrCreateGuestIdentity(null, () => UUID_B);
    expect(first?.id).toBe(second?.id);
    expect(first?.persistent).toBe(false);
  });

  it('fails closed when no valid cryptographic UUID can be created', () => {
    expect(loadOrCreateGuestIdentity(null, () => { throw new Error('crypto unavailable'); })).toBeNull();
  });
});
