import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import UnavailableNotice from './UnavailableNotice';

describe('UnavailableNotice', () => {
  it('renders an accessible return path and a native-disabled action', () => {
    const html = renderToStaticMarkup(
      <UnavailableNotice title="真人多人模式" description="当前不连接真人服务。" onBack={() => undefined} />,
    );
    expect(html).toContain('真人多人模式');
    expect(html).toContain('aria-label="返回"');
    expect(html).toContain('disabled=""');
  });
});
