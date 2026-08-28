import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('model adapter compatibility alias', () => {
  it('delegates to the canonical Gemini adapter', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../functions/model-adapter.cjs'), 'utf8');
    expect(source).toContain("require('./provider-adapter.cjs')");
  });
});
