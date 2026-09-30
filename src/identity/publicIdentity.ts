export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 40;
export const NICKNAME_MAX_LENGTH = 80;

export interface UsernameValidation {
  value: string;
  valid: boolean;
  error: string;
}

export const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export const validateUsername = (value: string): UsernameValidation => {
  const normalized = normalizeUsername(value);
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return {
      value: normalized,
      valid: false,
      error: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return {
      value: normalized,
      valid: false,
      error: 'Username may contain only lowercase letters, numbers, and underscores.',
    };
  }
  return { value: normalized, valid: true, error: '' };
};

export interface NicknameValidation {
  value: string;
  valid: boolean;
  error: string;
}

export const normalizeNickname = (value: string, username: string): NicknameValidation => {
  const normalized = value.trim() || normalizeUsername(username);
  if (!normalized) return { value: '', valid: false, error: 'A public name is required.' };
  if (normalized.length > NICKNAME_MAX_LENGTH) {
    return {
      value: normalized,
      valid: false,
      error: `Nickname must be ${NICKNAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { value: normalized, valid: true, error: '' };
};

export const GUEST_IDENTITY_SCHEMA = 'aiwerewolf.guest-identity';
export const GUEST_IDENTITY_VERSION = 1 as const;
export const GUEST_IDENTITY_STORAGE_KEY = 'aiwerewolf:identity:guest:v1';

export interface GuestIdentity {
  id: string;
  label: string;
  persistent: boolean;
  status: 'restored' | 'created' | 'runtime-only' | 'corrupt';
}

interface GuestIdentityEnvelopeV1 {
  schema: typeof GUEST_IDENTITY_SCHEMA;
  version: typeof GUEST_IDENTITY_VERSION;
  id: string;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isGuestPrincipalId = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('guest:') && UUID_V4.test(value.slice(6));

export const guestLabel = (id: string): string =>
  isGuestPrincipalId(id) ? `Guest ${id.slice(-8)}` : 'Guest';

export const parseGuestIdentity = (raw: string): string | null => {
  try {
    const value = JSON.parse(raw) as Partial<GuestIdentityEnvelopeV1> | null;
    if (!value || value.schema !== GUEST_IDENTITY_SCHEMA || value.version !== GUEST_IDENTITY_VERSION) return null;
    return isGuestPrincipalId(value.id) ? value.id : null;
  } catch {
    return null;
  }
};

let runtimeGuestId: string | null = null;
let runtimeGuestStatus: GuestIdentity['status'] | null = null;

const makeGuestId = (uuidFactory: () => string): string | null => {
  try {
    const id = `guest:${uuidFactory()}`;
    return isGuestPrincipalId(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
};

const runtimeIdentity = (
  uuidFactory: () => string,
  status: GuestIdentity['status'],
): GuestIdentity | null => {
  if (status === 'corrupt' && runtimeGuestStatus !== 'corrupt') runtimeGuestId = null;
  runtimeGuestId = runtimeGuestId && isGuestPrincipalId(runtimeGuestId)
    ? runtimeGuestId
    : makeGuestId(uuidFactory);
  if (!runtimeGuestId) return null;
  runtimeGuestStatus = status;
  return { id: runtimeGuestId, label: guestLabel(runtimeGuestId), persistent: false, status };
};

export const loadOrCreateGuestIdentity = (
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  uuidFactory: () => string = () => crypto.randomUUID(),
): GuestIdentity | null => {
  if (!storage) return runtimeIdentity(uuidFactory, 'runtime-only');

  let raw: string | null;
  try {
    raw = storage.getItem(GUEST_IDENTITY_STORAGE_KEY);
  } catch {
    return runtimeIdentity(uuidFactory, 'runtime-only');
  }

  if (raw !== null) {
    const restored = parseGuestIdentity(raw);
    if (!restored) return runtimeIdentity(uuidFactory, 'corrupt');
    runtimeGuestId = restored;
    runtimeGuestStatus = 'restored';
    return { id: restored, label: guestLabel(restored), persistent: true, status: 'restored' };
  }

  const id = makeGuestId(uuidFactory);
  if (!id) return null;
  const envelope: GuestIdentityEnvelopeV1 = {
    schema: GUEST_IDENTITY_SCHEMA,
    version: GUEST_IDENTITY_VERSION,
    id,
  };
  try {
    storage.setItem(GUEST_IDENTITY_STORAGE_KEY, JSON.stringify(envelope));
    if (parseGuestIdentity(storage.getItem(GUEST_IDENTITY_STORAGE_KEY) ?? '') !== id) {
      runtimeGuestId = id;
      runtimeGuestStatus = 'runtime-only';
      return { id, label: guestLabel(id), persistent: false, status: 'runtime-only' };
    }
    runtimeGuestId = id;
    runtimeGuestStatus = 'created';
    return { id, label: guestLabel(id), persistent: true, status: 'created' };
  } catch {
    runtimeGuestId = id;
    runtimeGuestStatus = 'runtime-only';
    return { id, label: guestLabel(id), persistent: false, status: 'runtime-only' };
  }
};

export const resetRuntimeGuestIdentityForTests = (): void => {
  runtimeGuestId = null;
  runtimeGuestStatus = null;
};
