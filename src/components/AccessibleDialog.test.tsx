import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AccessibleDialog, {
  acquireDocumentScrollLock,
  closeOnBackdropMouseDown,
  getFocusLoopTarget,
} from './AccessibleDialog';

describe('AccessibleDialog', () => {
  it('renders a named modal dialog and close control', () => {
    const markup = renderToStaticMarkup(
      <AccessibleDialog
        open
        title="Room details"
        description="Review before joining"
        onClose={vi.fn()}
      >
        <button type="button">Join</button>
      </AccessibleDialog>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toMatch(/aria-labelledby="dialog-title-[^"]+"/);
    expect(markup).toMatch(/aria-describedby="dialog-description-[^"]+"/);
    expect(markup).toContain('aria-label="关闭对话框"');
    expect(markup).toContain('Room details');
  });

  it('does not render while closed', () => {
    const markup = renderToStaticMarkup(
      <AccessibleDialog open={false} title="Hidden" onClose={vi.fn()}>
        Content
      </AccessibleDialog>,
    );

    expect(markup).toBe('');
  });

  it('wraps focus at both ends and recovers focus entering from outside', () => {
    const first = { id: 'first' };
    const middle = { id: 'middle' };
    const last = { id: 'last' };
    const focusable = [first, middle, last];

    expect(getFocusLoopTarget(focusable, last, false)).toBe(first);
    expect(getFocusLoopTarget(focusable, first, true)).toBe(last);
    expect(getFocusLoopTarget(focusable, middle, false)).toBeUndefined();
    expect(getFocusLoopTarget(focusable, { id: 'outside' }, false)).toBe(first);
    expect(getFocusLoopTarget([], null, false)).toBeNull();
  });

  it('prevents backdrop pointer default before close so restored focus survives the click lifecycle', () => {
    const backdrop = {} as HTMLDivElement;
    const callOrder: string[] = [];
    const preventDefault = vi.fn(() => callOrder.push('preventDefault'));
    const onClose = vi.fn(() => callOrder.push('close'));

    const closed = closeOnBackdropMouseDown({
      currentTarget: backdrop,
      target: backdrop,
      preventDefault,
    }, onClose);

    expect(closed).toBe(true);
    expect(callOrder).toEqual(['preventDefault', 'close']);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    const panel = {} as HTMLDivElement;
    const ignored = closeOnBackdropMouseDown({
      currentTarget: backdrop,
      target: panel,
      preventDefault,
    }, onClose);

    expect(ignored).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('locks background scrolling until the final open dialog releases it', () => {
    const style = { overflow: 'auto' } as CSSStyleDeclaration;
    const releaseFirst = acquireDocumentScrollLock(style);
    const releaseSecond = acquireDocumentScrollLock(style);

    expect(style.overflow).toBe('hidden');
    releaseFirst();
    expect(style.overflow).toBe('hidden');
    releaseFirst();
    expect(style.overflow).toBe('hidden');
    releaseSecond();
    expect(style.overflow).toBe('auto');
  });
});
