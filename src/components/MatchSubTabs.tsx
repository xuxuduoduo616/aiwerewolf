import React from 'react';

type SubTab = 'home' | 'beginner' | 'entertainment' | 'advanced';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS: { key: SubTab; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'beginner', label: '新手场' },
  { key: 'entertainment', label: '娱乐场' },
  { key: 'advanced', label: '进阶场' },
];

const MatchSubTabs: React.FC<Props> = ({ active, onSelect }) => {
  return (
    <div className="wol-subtabs">
      {TABS.map(tab => (
        <button
          key={tab.key}
          type="button"
          className={`wol-subtab${active === tab.key ? ' wol-subtab--active' : ''}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default MatchSubTabs;
