import React from 'react';

export interface TabItem<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  id: string;
  label: string;
  tabs: readonly TabItem<T>[];
  active: T;
  onSelect: (tab: T) => void;
}

export const getTabId = (tabListId: string, key: string): string => `${tabListId}-tab-${key}`;
export const getTabPanelId = (tabListId: string, key: string): string => `${tabListId}-panel-${key}`;

export const getNextTabIndex = (
  currentIndex: number,
  tabCount: number,
  key: string,
): number | null => {
  if (tabCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  return null;
};

/**
 * Generic sub-tab bar. Renders a horizontal scrollable row of buttons
 * with a roving tab stop, ARIA relationships, and standard arrow navigation.
 */
const TabBar = <T extends string>({ id, label, tabs, active, onSelect }: Props<T>) => {
  return (
    <div className="wol-subtabs" role="tablist" aria-label={label} aria-orientation="horizontal">
      {tabs.map((tab, index) => (
        <button
          key={tab.key}
          id={getTabId(id, tab.key)}
          type="button"
          role="tab"
          className={`wol-subtab${active === tab.key ? ' wol-subtab--active' : ''}`}
          aria-selected={active === tab.key}
          aria-controls={getTabPanelId(id, tab.key)}
          tabIndex={active === tab.key ? 0 : -1}
          onClick={() => onSelect(tab.key)}
          onKeyDown={event => {
            const nextIndex = getNextTabIndex(index, tabs.length, event.key);
            if (nextIndex === null) return;
            event.preventDefault();
            const nextTab = tabs[nextIndex];
            onSelect(nextTab.key);
            const tabElements = event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            tabElements?.[nextIndex]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabBar;
