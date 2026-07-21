import React from 'react';

export interface TabItem<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  tabs: readonly TabItem<T>[];
  active: T;
  onSelect: (tab: T) => void;
}

/**
 * Generic sub-tab bar. Renders a horizontal scrollable row of buttons
 * with ARIA tablist semantics and gold underline for the active tab.
 */
const TabBar = <T extends string>({ tabs, active, onSelect }: Props<T>) => {
  return (
    <div className="wol-subtabs" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className={`wol-subtab${active === tab.key ? ' wol-subtab--active' : ''}`}
          aria-selected={active === tab.key}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabBar;
