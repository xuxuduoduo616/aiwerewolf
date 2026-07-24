import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LobbySideMenus, {
  LEFT_MENUS,
  RIGHT_MENUS,
  activateLobbySideMenuItem,
  type LobbySideMenuHandlers,
  type LobbySideMenuItem,
} from './LobbySideMenus';

const findItem = (label: string): LobbySideMenuItem => {
  const item = [...LEFT_MENUS, ...RIGHT_MENUS].find(candidate => candidate.label === label);
  if (!item) throw new Error(`Missing side-menu item: ${label}`);
  return item;
};

describe('LobbySideMenus native routing', () => {
  const handlers: LobbySideMenuHandlers = {
    onNavigate: vi.fn(),
    onOpenSubview: vi.fn(),
    onOpenUtilityMenu: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['活动', 'activity'],
    ['阵营应援', 'faction-support'],
    ['通行证', 'battle-pass'],
  ] as const)('routes %s to the %s lobby surface', (label, subview) => {
    expect(activateLobbySideMenuItem(findItem(label), handlers)).toBe(true);
    expect(handlers.onOpenSubview).toHaveBeenCalledOnce();
    expect(handlers.onOpenSubview).toHaveBeenCalledWith(subview);
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onOpenUtilityMenu).not.toHaveBeenCalled();
  });

  it('routes 功能菜单 to the existing utility surface', () => {
    expect(activateLobbySideMenuItem(findItem('功能菜单'), handlers)).toBe(true);
    expect(handlers.onOpenUtilityMenu).toHaveBeenCalledOnce();
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onOpenSubview).not.toHaveBeenCalled();
  });

  it.each([
    ['限时娱乐', 'wolfvillage'],
    ['首充', 'shop'],
  ] as const)('preserves %s shell routing to %s', (label, view) => {
    expect(activateLobbySideMenuItem(findItem(label), handlers)).toBe(true);
    expect(handlers.onNavigate).toHaveBeenCalledOnce();
    expect(handlers.onNavigate).toHaveBeenCalledWith(view);
    expect(handlers.onOpenSubview).not.toHaveBeenCalled();
    expect(handlers.onOpenUtilityMenu).not.toHaveBeenCalled();
  });

  it('makes Tasks native-disabled and visibly unavailable', () => {
    const taskItem = findItem('任务');
    expect(activateLobbySideMenuItem(taskItem, handlers)).toBe(false);
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onOpenSubview).not.toHaveBeenCalled();
    expect(handlers.onOpenUtilityMenu).not.toHaveBeenCalled();

    const html = renderToStaticMarkup(
      <LobbySideMenus side="right" {...handlers} />,
    );
    expect(html).toContain('aria-label="任务，未开放"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('未开放');
  });

  it('gives every enabled launcher an explicit typed action', () => {
    for (const item of [...LEFT_MENUS, ...RIGHT_MENUS]) {
      if (item.disabled) continue;
      expect(item.action).toBeDefined();
    }
  });
});
