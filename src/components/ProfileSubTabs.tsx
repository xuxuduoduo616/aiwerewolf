import React from 'react';

type SubTab = 'outfits' | 'decorations' | 'runwolf' | 'scenes' | 'skins' | 'backpack';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS: { key: SubTab; label: string }[] = [
  { key: 'outfits',     label: '时装' },
  { key: 'decorations', label: '装饰' },
  { key: 'runwolf',     label: '跑跑狼' },
  { key: 'scenes',      label: '场景' },
  { key: 'skins',       label: '皮肤' },
  { key: 'backpack',    label: '背包' },
];

const ProfileSubTabs: React.FC<Props> = ({ active, onSelect }) => {
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

export default ProfileSubTabs;
