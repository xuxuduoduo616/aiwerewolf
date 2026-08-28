import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('genai proxy compatibility alias', () => {
  it('shares the canonical bounded Gemini handler', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../functions/genai-proxy.cjs'), 'utf8');
    expect(source).toContain("require('./provider-adapter.cjs')");
  });
});
