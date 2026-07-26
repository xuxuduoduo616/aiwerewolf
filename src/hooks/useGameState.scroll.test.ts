import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { scrollLogTailIntoView } from './useGameState';

const hookSource = readFileSync(new URL('./useGameState.ts', import.meta.url), 'utf8');

describe('useGameState log auto-follow boundary', () => {
  it('scrolls a present log tail once with smooth nearest-block alignment only', () => {
    const scrollIntoView = vi.fn();
    const element = { scrollIntoView };
    const fakeWindowScroll = { scrollTop: 31, scrollTo: vi.fn() };
    const fakeDocumentScroll = { scrollTop: 47, scrollTo: vi.fn() };

    scrollLogTailIntoView(element);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(scrollIntoView.mock.calls[0]).toHaveLength(1);
    expect(fakeWindowScroll).toMatchObject({ scrollTop: 31 });
    expect(fakeDocumentScroll).toMatchObject({ scrollTop: 47 });
    expect(fakeWindowScroll.scrollTo).not.toHaveBeenCalled();
    expect(fakeDocumentScroll.scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing for a null log tail', () => {
    expect(() => scrollLogTailIntoView(null)).not.toThrow();
  });

  it('routes the existing effect through the helper without changing dependencies', () => {
    expect(hookSource).toMatch(
      /useEffect\(\(\) => \{\s*scrollLogTailIntoView\(logsEndRef\.current\);\s*\}, \[logs, currentSpeaker, wolfChat\]\);/,
    );
  });
});
