import { describe, expect, it } from 'vitest';
import { isTurnstileGuestGateOpen, nextTurnstileToken } from './App';

describe('App Turnstile guest gate', () => {
  it('opens after a successful verification', () => {
    const token = nextTurnstileToken({ type: 'verified', token: 'verified' });

    expect(token).toBe('verified');
    expect(isTurnstileGuestGateOpen(token)).toBe(true);
  });

  it('closes on an error', () => {
    const token = nextTurnstileToken({ type: 'error' });

    expect(token).toBeNull();
    expect(isTurnstileGuestGateOpen(token)).toBe(false);
  });

  it('closes when verification expires', () => {
    const token = nextTurnstileToken({ type: 'expired' });

    expect(token).toBeNull();
    expect(isTurnstileGuestGateOpen(token)).toBe(false);
  });
});
