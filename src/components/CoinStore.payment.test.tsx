import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CoinStore from './CoinStore';

describe('CoinStore payment availability', () => {
  it('keeps all products and prices visible behind disabled controls', () => {
    const onPurchase = vi.fn();
    const html = renderToStaticMarkup(
      <CoinStore coins={1234} coupons={56} crystals={7} onPurchase={onPurchase} />,
    );

    for (const [amount, price] of [
      [60, 6],
      [300, 30],
      [680, 68],
      [1280, 128],
      [3280, 328],
      [6480, 648],
    ]) {
      expect(html).toContain(`${amount}金币 ¥${price}，充值功能暂不可用`);
    }

    expect(html.match(/<button/g)).toHaveLength(7);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(7);
    expect(html).toContain('1,234');
    expect(html).toContain('充值功能暂不可用');
    expect(html).toContain('当前未配置支付服务，暂时无法创建订单或发放金币。');
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it('associates every unavailable control with the visible status explanation', () => {
    const html = renderToStaticMarkup(
      <CoinStore coins={0} coupons={0} crystals={0} onPurchase={vi.fn()} />,
    );

    expect(html).toContain('id="payments-unavailable-description"');
    expect(html.match(/aria-describedby="payments-unavailable-description"/g)).toHaveLength(7);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('测试模式');
    expect(html).not.toContain('购买成功');
    expect(html).not.toContain('处理中');
  });
});
