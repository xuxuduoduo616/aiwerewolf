import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LeaveGameDialog from './LeaveGameDialog';

describe('LeaveGameDialog', () => {
  it('names the modal, explains progress loss, and provides separate cancel and destructive controls', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const html = renderToStaticMarkup(<LeaveGameDialog
      onCancel={onCancel}
      onConfirm={onConfirm}
      returnFocusRef={React.createRef<HTMLButtonElement>()}
    />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="dialog-title-[^"]+"/);
    expect(html).toMatch(/aria-describedby="dialog-description-[^"]+"/);
    expect(html).toContain('Leave this game?');
    expect(html).toContain('current match progress will be lost');
    expect(html).toContain('aria-label="Cancel leaving game"');
    expect(html).toContain('class="wol-btn wol-btn--ghost">Cancel</button>');
    expect(html).toContain('class="wol-btn wol-btn--danger">Leave game</button>');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
