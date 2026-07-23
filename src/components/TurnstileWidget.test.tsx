import { describe, expect, it, vi } from 'vitest';
import { createTurnstileRenderOptions } from './TurnstileWidget';

describe('TurnstileWidget render options', () => {
  it('forces English and preserves lifecycle callbacks', () => {
    const onVerify = vi.fn();
    const onError = vi.fn();
    const onExpired = vi.fn();
    const options = createTurnstileRenderOptions({
      siteKey: 'configured-site-key',
      onVerify,
      onError,
      onExpired,
    });

    expect(options.language).toBe('en');
    expect(options.theme).toBe('dark');
    options.callback('verified');
    options['error-callback']?.();
    options['expired-callback']?.();

    expect(onVerify).toHaveBeenCalledWith('verified');
    expect(onError).toHaveBeenCalledOnce();
    expect(onExpired).toHaveBeenCalledOnce();
  });
});
