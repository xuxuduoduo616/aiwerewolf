import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  RELEASE_TRAILER,
  determineExitCode,
  hasExactReleaseTrailer,
} = require('./netlify-ignore-build.cjs');

const COMMIT_REF = 'a'.repeat(40);

describe('Netlify release authorization trailer', () => {
  it('accepts the exact trailer in the final Git trailer block', () => {
    expect(hasExactReleaseTrailer(`Release AI model routing\n\n${RELEASE_TRAILER}\n`)).toBe(true);
    expect(
      hasExactReleaseTrailer(
        `Release AI model routing\n\n${RELEASE_TRAILER}\nSigned-off-by: Release Owner`,
      ),
    ).toBe(true);
  });

  it.each([
    ['missing trailer', 'Release AI model routing'],
    ['body text only', `Release AI model routing\n${RELEASE_TRAILER}`],
    ['wrong value case', 'Release AI model routing\n\nNetlify-Release: TRUE'],
    ['trailing whitespace', `Release AI model routing\n\n${RELEASE_TRAILER} `],
    ['duplicate trailer', `Release AI model routing\n${RELEASE_TRAILER}\n\n${RELEASE_TRAILER}`],
    ['not the final paragraph', `${RELEASE_TRAILER}\n\nRelease notes`],
    ['non-trailer final block', `Release AI model routing\n\nNotes\n${RELEASE_TRAILER}`],
  ])('rejects %s', (_name, message) => {
    expect(hasExactReleaseTrailer(message)).toBe(false);
  });
});

describe('Netlify ignore exit code', () => {
  it('returns 1 only when the current deploy commit has the exact trailer', () => {
    const readMessage = vi.fn(() => `Release AI model routing\n\n${RELEASE_TRAILER}\n`);

    expect(determineExitCode({ env: { COMMIT_REF }, readMessage })).toBe(1);
    expect(readMessage).toHaveBeenCalledWith(COMMIT_REF);
  });

  it('returns 0 when authorization is absent', () => {
    expect(
      determineExitCode({
        env: { COMMIT_REF },
        readMessage: () => 'Routine intermediate change',
      }),
    ).toBe(0);
  });

  it.each([undefined, '', 'HEAD', 'a'.repeat(39), 'g'.repeat(40)])(
    'returns 0 without a valid full commit SHA (%s)',
    (commitRef) => {
      const readMessage = vi.fn();
      expect(determineExitCode({ env: { COMMIT_REF: commitRef }, readMessage })).toBe(0);
      expect(readMessage).not.toHaveBeenCalled();
    },
  );

  it('fails credit-safe when reading Git metadata throws', () => {
    expect(
      determineExitCode({
        env: { COMMIT_REF },
        readMessage: () => {
          throw new Error('simulated Git failure');
        },
      }),
    ).toBe(0);
  });
});
