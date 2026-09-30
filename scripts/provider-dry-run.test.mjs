import { describe, expect, it } from 'vitest';
import { runProviderDryRun } from './provider-dry-run.mjs';

describe('provider dry-run', () => {
  it('checks only an offline response contract', async () => {
    await expect(runProviderDryRun()).resolves.toBe(true);
  });
});
